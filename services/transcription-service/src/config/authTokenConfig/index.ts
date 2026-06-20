import { Config } from "effect";

/**
 * Typed config for the `/transcribe` bearer gate — the app-layer check
 * behind Cloud Run IAM. The obsidian-mcp server fetches the same value
 * from Secret Manager (`transcription-service-bearer`).
 *
 * Required, not defaulted — a missing token must fail loud at boot rather
 * than start a service that accepts unauthenticated transcription.
 */
export const authTokenConfig = Config.all({
  bearer: Config.redacted("AUTH_BEARER_TOKEN"),
});
