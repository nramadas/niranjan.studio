import { Effect, Layer, Option, Redacted } from "effect";
import { TranscriptionClient, type TranscriptionClientImpl } from "../TranscriptionClient";
import { TranscriptionUnavailableError } from "../errors/TranscriptionUnavailableError";
import type { TranscriptResult, TranscriptSegment } from "../types.ts";

interface Params {
  readonly url: string;
  readonly bearer: Redacted.Redacted<string>;
  readonly audience: Option.Option<string>;
  readonly useIdToken: boolean;
  readonly timeoutMs: number;
}

const METADATA_IDENTITY_URL =
  "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity";

/**
 * Build the Layer providing `TranscriptionClient`. The transcription-service
 * is Cloud Run IAM-private, so the client sends two distinct auth headers:
 *   - `Authorization: Bearer <ID_TOKEN>` — a Google-signed identity token
 *     from the metadata server, consumed by Cloud Run IAM at the edge.
 *   - `X-Transcription-Token: Bearer <app-bearer>` — the app-layer secret,
 *     checked inside the service (Authorization is taken by the ID token).
 *
 * In local dev (`useIdToken=false`, or no metadata server) the ID token is
 * omitted and only the app bearer is sent.
 */
export const TranscriptionClientLayer = (params: Params) =>
  Layer.succeed(TranscriptionClient, buildImpl(params));

const buildImpl = (params: Params): TranscriptionClientImpl => {
  const trimmed = params.url.replace(/\/+$/, "");
  const audience = Option.getOrElse(params.audience, () => trimmed);

  // Best-effort metadata-server ID token. Any failure (local dev, no
  // metadata server) degrades to "no ID token" rather than failing the call.
  const fetchIdToken = (): Effect.Effect<string | undefined> =>
    !params.useIdToken
      ? Effect.succeed(undefined)
      : Effect.tryPromise(() =>
          fetch(`${METADATA_IDENTITY_URL}?audience=${encodeURIComponent(audience)}`, {
            headers: { "Metadata-Flavor": "Google" },
          }),
        ).pipe(
          Effect.flatMap((res) => (res.ok ? Effect.promise(() => res.text()) : Effect.succeed(""))),
          Effect.map((t) => (t.length > 0 ? t : undefined)),
          Effect.catchAll(() => Effect.succeed(undefined)),
        );

  return {
    transcribe: (audio, diarize) =>
      Effect.gen(function* () {
        const idToken = yield* fetchIdToken();
        if (params.useIdToken && !idToken) {
          // The service is IAM-private; without an ID token the call would be
          // rejected at the Cloud Run edge with an opaque 403. Fail with an
          // attributable error instead.
          return yield* Effect.fail(
            new TranscriptionUnavailableError({
              reason: "network",
              message: `could not obtain a Cloud Run ID token from the metadata server (audience ${audience}); the IAM-private transcription-service would reject the call`,
            }),
          );
        }
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), params.timeoutMs);

        const headers: Record<string, string> = {
          "Content-Type": "application/json",
          "X-Transcription-Token": `Bearer ${Redacted.value(params.bearer)}`,
        };
        if (idToken) headers.Authorization = `Bearer ${idToken}`;

        const res = yield* Effect.tryPromise({
          try: () =>
            fetch(`${trimmed}/transcribe`, {
              method: "POST",
              headers,
              body: JSON.stringify({
                audioUrl: audio.url,
                audioBase64: audio.base64,
                mimeType: audio.mimeType,
                diarize,
              }),
              signal: controller.signal,
            }),
          catch: (cause) => {
            const isAbort = cause instanceof Error && cause.name === "AbortError";
            return new TranscriptionUnavailableError({
              reason: isAbort ? "timeout" : "network",
              message: isAbort
                ? `transcription /transcribe timed out after ${params.timeoutMs}ms`
                : `transcription /transcribe network error: ${cause instanceof Error ? cause.message : String(cause)}`,
              cause,
            });
          },
        }).pipe(Effect.ensuring(Effect.sync(() => clearTimeout(timer))));

        if (!res.ok) {
          const text = yield* Effect.promise(() => res.text().catch(() => ""));
          return yield* Effect.fail(
            new TranscriptionUnavailableError({
              reason: "bad_status",
              status: res.status,
              message: `transcription /transcribe returned ${res.status}: ${text.slice(0, 300)}`,
            }),
          );
        }

        const json = yield* Effect.tryPromise({
          try: () => res.json() as Promise<Partial<TranscriptResult>>,
          catch: (cause) =>
            new TranscriptionUnavailableError({
              reason: "bad_body",
              message: `transcription /transcribe returned non-JSON: ${cause instanceof Error ? cause.message : String(cause)}`,
              cause,
            }),
        });

        if (!json || !Array.isArray(json.segments)) {
          return yield* Effect.fail(
            new TranscriptionUnavailableError({
              reason: "bad_body",
              message: "transcription /transcribe response missing 'segments' array",
            }),
          );
        }

        return {
          segments: json.segments as ReadonlyArray<TranscriptSegment>,
          language: json.language,
          durationSec: json.durationSec,
          modelName: json.modelName ?? "unknown",
        };
      }),
  };
};
