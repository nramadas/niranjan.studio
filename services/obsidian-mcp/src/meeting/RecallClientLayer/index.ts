import { Effect, Layer, Redacted } from "effect";
import { type CreateBotInput, RecallClient, type RecallClientImpl } from "../RecallClient";
import { RecallError } from "../errors/RecallError";
import { type RecallBotResponse, extractAudioDownloadUrl } from "../extractAudioDownloadUrl";

interface Params {
  readonly apiBase: string;
  readonly apiKey: Redacted.Redacted<string>;
  readonly botName: string;
  readonly recordingConfigJson: string;
  readonly timeoutMs: number;
}

// The slices of Recall's bot response we read, beyond the media shortcuts
// handled by extractAudioDownloadUrl. All optional/defensive — the exact
// field names should be confirmed against a live Recall response; missing
// fields degrade to empty/undefined without breaking the core flow.
interface StatusChange {
  readonly code?: string;
}
interface Participant {
  readonly name?: string;
}
interface BotDetails extends RecallBotResponse {
  readonly status_changes?: ReadonlyArray<StatusChange>;
  readonly meeting_participants?: ReadonlyArray<Participant>;
  readonly meeting_metadata?: { readonly platform?: string };
  readonly platform?: string;
}

const latestStatus = (b: BotDetails): string | undefined => {
  const changes = b.status_changes ?? [];
  return changes[changes.length - 1]?.code;
};

const extractParticipants = (b: BotDetails): ReadonlyArray<string> => {
  const seen = new Set<string>();
  for (const p of b.meeting_participants ?? []) {
    const name = (p.name ?? "").trim();
    if (name) seen.add(name);
  }
  return [...seen];
};

const extractPlatform = (b: BotDetails): string | undefined =>
  b.meeting_metadata?.platform ?? b.platform;

/**
 * Recall.ai meeting-bot client. Uses Node's built-in `fetch` with
 * `Authorization: Token <key>` and an AbortController timeout. Every
 * failure path produces a tagged `RecallError`.
 *
 * NOTE: the create-bot `recording_config` (audio-only, no Recall
 * transcription, short retention) and the leave/delete endpoint paths
 * reflect Recall's documented v1 API; confirm them against your account's
 * API reference before the first real meeting. The recording_config is
 * overridable via `RECALL_RECORDING_CONFIG_JSON` without a code change.
 */
export const RecallClientLayer = (params: Params) => Layer.succeed(RecallClient, buildImpl(params));

const buildImpl = (params: Params): RecallClientImpl => {
  const base = params.apiBase.replace(/\/+$/, "");
  const token = Redacted.value(params.apiKey);

  const request = (
    op: string,
    method: string,
    path: string,
    body?: unknown,
  ): Effect.Effect<unknown, RecallError> =>
    Effect.gen(function* () {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), params.timeoutMs);
      const res = yield* Effect.tryPromise({
        try: () =>
          fetch(`${base}${path}`, {
            method,
            headers: {
              Authorization: `Token ${token}`,
              ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
            },
            body: body !== undefined ? JSON.stringify(body) : undefined,
            signal: controller.signal,
          }),
        catch: (cause) => {
          const isAbort = cause instanceof Error && cause.name === "AbortError";
          return new RecallError({
            op,
            message: isAbort
              ? `Recall ${op} timed out after ${params.timeoutMs}ms`
              : `Recall ${op} network error: ${cause instanceof Error ? cause.message : String(cause)}`,
            cause,
          });
        },
      }).pipe(Effect.ensuring(Effect.sync(() => clearTimeout(timer))));

      const text = yield* Effect.promise(() => res.text().catch(() => ""));
      if (!res.ok) {
        return yield* Effect.fail(
          new RecallError({
            op,
            status: res.status,
            message: `Recall ${op} returned ${res.status}: ${text.slice(0, 300)}`,
          }),
        );
      }
      // leave_call / delete_media return an empty body on success.
      if (!text) return {};
      try {
        return JSON.parse(text) as unknown;
      } catch (cause) {
        return yield* Effect.fail(
          new RecallError({ op, message: `Recall ${op} returned a non-JSON body`, cause }),
        );
      }
    });

  return {
    createBot: (input: CreateBotInput) =>
      Effect.gen(function* () {
        const recordingConfig = yield* Effect.try({
          try: () => JSON.parse(params.recordingConfigJson) as unknown,
          catch: (cause) =>
            new RecallError({
              op: "create_bot",
              message: `invalid RECALL_RECORDING_CONFIG_JSON: ${cause instanceof Error ? cause.message : String(cause)}`,
              cause,
            }),
        });
        const json = (yield* request("create_bot", "POST", "/api/v1/bot/", {
          meeting_url: input.meetingUrl,
          bot_name: params.botName,
          recording_config: recordingConfig,
          metadata: input.metadata,
        })) as { id?: unknown };
        if (typeof json.id !== "string" || json.id.length === 0) {
          return yield* Effect.fail(
            new RecallError({
              op: "create_bot",
              message: "Recall create-bot response missing string 'id'",
            }),
          );
        }
        return { id: json.id };
      }),

    getBot: (botId) =>
      Effect.gen(function* () {
        const json = (yield* request("get_bot", "GET", `/api/v1/bot/${botId}/`)) as BotDetails;
        return { id: botId, status: latestStatus(json) };
      }),

    leaveCall: (botId) =>
      Effect.asVoid(request("leave_call", "POST", `/api/v1/bot/${botId}/leave_call/`)),

    getRecording: (botId) =>
      Effect.gen(function* () {
        const json = (yield* request(
          "get_recording",
          "GET",
          `/api/v1/bot/${botId}/`,
        )) as BotDetails;
        return {
          audioUrl: extractAudioDownloadUrl(json),
          participants: extractParticipants(json),
          platform: extractPlatform(json),
        };
      }),

    deleteMedia: (botId) =>
      Effect.asVoid(request("delete_media", "POST", `/api/v1/bot/${botId}/delete_media/`)),
  };
};
