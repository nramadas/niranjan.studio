import { Config } from "effect";
import { allowedEmailsConfig } from "../allowedEmailsConfig";
import { couchDbConfig } from "../couchDbConfig";
import { googleOidcConfig } from "../googleOidcConfig";
import { liveSyncConfig } from "../liveSyncConfig";
import { oauthConfig } from "../oauthConfig";
import { searchConfig } from "../searchConfig";
import { serverConfig } from "../serverConfig";

/**
 * The combined config tree the runtime resolves at boot. Composing the
 * per-area configs into a single Config means env-var resolution happens
 * once and any failure surfaces as a single structured error from
 * `Effect.runPromise(allConfig)`.
 */
export const allConfig = Config.all({
  couchDb: couchDbConfig,
  liveSync: liveSyncConfig,
  oauth: oauthConfig,
  googleOidc: googleOidcConfig,
  allowedEmails: allowedEmailsConfig,
  server: serverConfig,
  search: searchConfig,
});

export type AppConfig = Config.Config.Success<typeof allConfig>;
