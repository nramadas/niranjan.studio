import { Effect, Layer, Option, type Redacted } from "effect";
import { TranscriptionError } from "../../lib/errors/TranscriptionError";
import { DeepgramTranscriberLayer } from "../DeepgramTranscriberLayer";
import { Transcriber } from "../Transcriber";

interface Params {
  readonly kind: "deepgram" | "local";
  readonly deepgramApiKey: Option.Option<Redacted.Redacted<string>>;
  readonly deepgramModel: string;
}

/**
 * Pick the concrete `Transcriber` layer from the `TRANSCRIBER` config
 * value — the same shape as the vault-indexer's `selectEmbedderLayer`.
 * Centralising the choice here means the HTTP layer composes a single
 * `Transcriber` and never sees which backend is wired in.
 *
 * `deepgram` requires `DEEPGRAM_API_KEY`; a missing key surfaces at boot
 * as a `TranscriptionError` through a failing layer (resolved eagerly in
 * `main`) rather than 500-ing on the first request. `local` is reserved
 * for a future on-VM model and fails fast today.
 */
export const selectTranscriberLayer = (params: Params) => {
  switch (params.kind) {
    case "deepgram":
      return Option.match(params.deepgramApiKey, {
        onNone: () => failLayer("TRANSCRIBER=deepgram requires DEEPGRAM_API_KEY to be set"),
        onSome: (apiKey) => DeepgramTranscriberLayer({ apiKey, model: params.deepgramModel }),
      });
    case "local":
      return failLayer("TRANSCRIBER=local is not implemented yet");
  }
};

// A layer that fails when built, surfacing a config error at boot. Cast to
// the success-layer shape so both switch arms share one return type — the
// same technique selectEmbedderLayer uses for its missing-key path.
const failLayer = (message: string): ReturnType<typeof DeepgramTranscriberLayer> =>
  Layer.effect(
    Transcriber,
    Effect.fail(new TranscriptionError({ provider: "config", message })),
  ) as ReturnType<typeof DeepgramTranscriberLayer>;
