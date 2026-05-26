import { Config } from "effect";

/**
 * Typed config for the LiveSync E2EE passphrase. Held in Secret Manager
 * and mounted as `LIVESYNC_PASSPHRASE` by Cloud Run. Marked redacted so it
 * never appears in stringified config or in Effect's structured error
 * output.
 */
export const liveSyncConfig = Config.all({
  passphrase: Config.redacted("LIVESYNC_PASSPHRASE"),
});
