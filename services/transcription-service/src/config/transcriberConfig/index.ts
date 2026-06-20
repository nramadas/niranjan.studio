import { Config } from "effect";

/**
 * Typed config for the speech-to-text backend selection.
 *
 * `TRANSCRIBER` chooses the backend (`deepgram` by default). The Deepgram
 * key is optional at the config layer — `selectTranscriberLayer` enforces
 * "deepgram requires a key", failing loud at boot — so a future
 * `TRANSCRIBER=local` deployment need not set a Deepgram key.
 */
export const transcriberConfig = Config.all({
  kind: Config.literal(
    "deepgram",
    "local",
  )("TRANSCRIBER").pipe(Config.withDefault("deepgram" as const)),
  deepgramApiKey: Config.redacted("DEEPGRAM_API_KEY").pipe(Config.option),
  deepgramModel: Config.string("DEEPGRAM_MODEL").pipe(Config.withDefault("nova-3")),
});
