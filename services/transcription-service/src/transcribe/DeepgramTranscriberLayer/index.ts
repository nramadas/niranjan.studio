import { Effect, Layer, Redacted } from "effect";
import { TranscriptionError } from "../../lib/errors/TranscriptionError";
import { Transcriber, type TranscriberImpl } from "../Transcriber";
import { type DeepgramResponse, parseDeepgramResponse } from "../parseDeepgramResponse";
import type { AudioInput, TranscribeOptions, TranscriptResult } from "../types.ts";

interface Params {
  readonly apiKey: Redacted.Redacted<string>;
  readonly model: string;
}

const DEEPGRAM_URL = "https://api.deepgram.com/v1/listen";

/**
 * Deepgram pre-recorded (batch) speech-to-text backend.
 *
 * POSTs to `/v1/listen` with diarize + utterances + smart_format so the
 * response comes back as speaker-grouped utterances. A remote audio URL is
 * sent as a JSON body (Deepgram fetches it — the bot path); raw bytes are
 * sent as the binary body with their MIME type (the future phone-app
 * path). Stateless and retry-free — the caller (obsidian-mcp) owns retry
 * and deletion policy.
 */
export const DeepgramTranscriberLayer = (params: Params) =>
  Layer.succeed(Transcriber, buildImpl(params));

const buildImpl = (params: Params): TranscriberImpl => ({
  modelName: `deepgram-${params.model}`,
  transcribe: (audio, opts) => transcribe(params, audio, opts),
});

const buildUrl = (model: string, diarize: boolean): string => {
  const qs = new URLSearchParams({
    model,
    smart_format: "true",
    punctuate: "true",
    diarize: String(diarize),
    utterances: String(diarize),
    detect_language: "true",
  });
  return `${DEEPGRAM_URL}?${qs.toString()}`;
};

const transcribe = (
  params: Params,
  audio: AudioInput,
  opts?: TranscribeOptions,
): Effect.Effect<TranscriptResult, TranscriptionError> =>
  Effect.gen(function* () {
    const diarize = opts?.diarize ?? true;
    const modelName = `deepgram-${params.model}`;

    const headers: Record<string, string> = {
      Authorization: `Token ${Redacted.value(params.apiKey)}`,
    };
    let body: string | Uint8Array;
    if (audio.url) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify({ url: audio.url });
    } else if (audio.bytes && audio.bytes.length > 0) {
      headers["Content-Type"] = audio.mimeType ?? "audio/mpeg";
      body = audio.bytes;
    } else {
      return yield* Effect.fail(
        new TranscriptionError({
          provider: "deepgram",
          message: "no audio provided: expected one of audioUrl or audioBase64",
        }),
      );
    }

    const res = yield* Effect.tryPromise({
      try: () => fetch(buildUrl(params.model, diarize), { method: "POST", headers, body }),
      catch: (cause) =>
        new TranscriptionError({
          provider: "deepgram",
          message: `Deepgram request failed: ${cause instanceof Error ? cause.message : String(cause)}`,
          cause,
        }),
    });

    if (!res.ok) {
      const text = yield* Effect.promise(() => res.text().catch(() => ""));
      return yield* Effect.fail(
        new TranscriptionError({
          provider: "deepgram",
          status: res.status,
          message: `Deepgram returned ${res.status}: ${text.slice(0, 500)}`,
        }),
      );
    }

    const json = (yield* Effect.tryPromise({
      try: () => res.json(),
      catch: (cause) =>
        new TranscriptionError({
          provider: "deepgram",
          message: `Deepgram response was not valid JSON: ${cause instanceof Error ? cause.message : String(cause)}`,
          cause,
        }),
    })) as DeepgramResponse;

    return parseDeepgramResponse(json, modelName);
  });
