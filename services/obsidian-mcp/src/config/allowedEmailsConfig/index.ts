import { Config } from "effect";

/**
 * Allow-list of email addresses permitted to authenticate. Sourced from a
 * comma-separated env var; parsed once at boot into a Set for O(1)
 * lookup in the Google callback. An empty string is rejected — leaving
 * it blank would let anyone with a Google account in.
 */
export const allowedEmailsConfig = Config.all({
  emails: Config.string("ALLOWED_EMAILS").pipe(
    Config.mapAttempt((csv) => {
      const set = new Set(
        csv
          .split(",")
          .map((s) => s.trim().toLowerCase())
          .filter(Boolean),
      );
      if (set.size === 0) {
        throw new Error("ALLOWED_EMAILS resolved to an empty set; refusing to allow all comers");
      }
      return set;
    }),
  ),
});
