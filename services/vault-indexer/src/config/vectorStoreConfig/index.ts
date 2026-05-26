import { Config } from "effect";

/**
 * Typed config for the on-disk SQLite vector store.
 *
 * `sqlitePath` is the file path the indexer reads and writes. In
 * production this lives on the compose-volume-backed `/var/lib/vault-indexer/`
 * so it survives container restarts and lands in the Phase 1 backup
 * tarball. The default is the production path; override for local dev
 * with a workspace-relative path that's outside the source tree.
 *
 * `vacuumOnBoot` is an escape hatch: if a previous deploy crashed
 * mid-write and the file is bloated with stale rows, set this to true on
 * the next start to compact it. Off by default — the cost is a
 * full-file rewrite at boot.
 */
export const vectorStoreConfig = Config.all({
  sqlitePath: Config.string("SQLITE_PATH").pipe(
    Config.withDefault("/var/lib/vault-indexer/vectors.db"),
  ),
  vacuumOnBoot: Config.boolean("VECTOR_STORE_VACUUM_ON_BOOT").pipe(Config.withDefault(false)),
});
