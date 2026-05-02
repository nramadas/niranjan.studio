import { Config } from "effect";

/**
 * Typed config for the in-memory search index. The debounce window
 * controls how long the index waits after a `_changes` event before
 * rebuilding — too short and we churn on rapid edits, too long and
 * search results lag behind the vault.
 */
export const searchConfig = Config.all({
  rebuildDebounceMs: Config.integer("SEARCH_REBUILD_DEBOUNCE_MS").pipe(Config.withDefault(5000)),
});
