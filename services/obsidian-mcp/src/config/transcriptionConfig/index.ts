import { Config } from "effect";

/**
 * Typed config for the transcription-service client (Phase 4).
 *
 * The MCP calls the isolated transcription-service's `/transcribe` to turn
 * a meeting recording into a diarized transcript. The service is Cloud Run
 * IAM-private, so the MCP attaches a Google-signed ID token in the
 * `Authorization` header (fetched from the metadata server) AND an
 * app-layer bearer in `X-Transcription-Token` — two distinct headers
 * because Cloud Run IAM consumes `Authorization` for the ID token.
 *
 * `url`        — Internal Cloud Run URL of the transcription-service.
 * `bearer`     — Shared app-layer secret; same value the service reads as
 *                AUTH_BEARER_TOKEN.
 * `audience`   — ID-token audience; defaults to `url`. Set explicitly only
 *                if the IAM audience must differ from the request URL.
 * `useIdToken` — Whether to fetch + attach a metadata-server ID token.
 *                True in production (Cloud Run IAM); set false for local
 *                dev against a non-IAM service.
 * `timeoutMs`  — Per-request timeout. Transcription of a long meeting can
 *                take tens of seconds, so this is generous.
 */
export const transcriptionConfig = Config.all({
  url: Config.string("TRANSCRIPTION_URL"),
  bearer: Config.redacted("TRANSCRIPTION_BEARER_TOKEN"),
  audience: Config.string("TRANSCRIPTION_AUDIENCE").pipe(Config.option),
  useIdToken: Config.boolean("TRANSCRIPTION_USE_ID_TOKEN").pipe(Config.withDefault(true)),
  timeoutMs: Config.integer("TRANSCRIPTION_TIMEOUT_MS").pipe(Config.withDefault(120000)),
});
