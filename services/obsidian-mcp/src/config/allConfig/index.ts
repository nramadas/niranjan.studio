import { couchDbConfig } from "@niranjan/vault-shared/config/couchDbConfig";
import { liveSyncConfig } from "@niranjan/vault-shared/config/liveSyncConfig";
import { Config } from "effect";
import { allowedEmailsConfig } from "../allowedEmailsConfig";
import { googleOidcConfig } from "../googleOidcConfig";
import { indexerConfig } from "../indexerConfig";
import { oauthConfig } from "../oauthConfig";
import { recallConfig } from "../recallConfig";
import { searchConfig } from "../searchConfig";
import { serverConfig } from "../serverConfig";
import { transcriptionConfig } from "../transcriptionConfig";

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
  indexer: indexerConfig,
  recall: recallConfig,
  transcription: transcriptionConfig,
});

export type AppConfig = Config.Config.Success<typeof allConfig>;
