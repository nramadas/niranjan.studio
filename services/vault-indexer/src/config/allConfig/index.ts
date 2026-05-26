import { couchDbConfig } from "@niranjan/vault-shared/config/couchDbConfig";
import { liveSyncConfig } from "@niranjan/vault-shared/config/liveSyncConfig";
import { Config } from "effect";
import { changesConfig } from "../changesConfig";
import { chunkingConfig } from "../chunkingConfig";
import { embedderConfig } from "../embedderConfig";
import { searchTokenConfig } from "../searchTokenConfig";
import { serverConfig } from "../serverConfig";
import { vectorStoreConfig } from "../vectorStoreConfig";

/**
 * The combined config tree resolved at boot. Composing the per-area
 * configs into a single `Config.all` means env-var resolution happens
 * once and any failure surfaces as one structured error from
 * `Effect.runPromise(allConfig)`.
 *
 * CouchDB and LiveSync configs come from the shared package — same
 * shape, same env-var names, as the MCP service consumes — so a vault
 * deployment is configured from one source of truth per concern.
 */
export const allConfig = Config.all({
  couchDb: couchDbConfig,
  liveSync: liveSyncConfig,
  server: serverConfig,
  embedder: embedderConfig,
  vectorStore: vectorStoreConfig,
  searchToken: searchTokenConfig,
  chunking: chunkingConfig,
  changes: changesConfig,
});

export type AppConfig = Config.Config.Success<typeof allConfig>;
