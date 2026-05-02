import { Config } from "effect";
import { authConfig } from "../authConfig";
import { cloudflareAccessConfig } from "../cloudflareAccessConfig";
import { couchDbConfig } from "../couchDbConfig";
import { liveSyncConfig } from "../liveSyncConfig";
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
  cloudflareAccess: cloudflareAccessConfig,
  auth: authConfig,
  server: serverConfig,
  search: searchConfig,
});

export type AppConfig = Config.Config.Success<typeof allConfig>;
