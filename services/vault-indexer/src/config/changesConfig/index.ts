import { Config } from "effect";

/**
 * Typed config for the `_changes` subscription and the per-document-ID
 * coalescing queue.
 *
 * `debounceMs` is how long the queue waits after the most recent change
 * event for a given doc id before triggering a re-index of that doc.
 * Higher values collapse rapid successive edits into fewer embedder
 * invocations; lower values reduce the staleness window. The 2 s default
 * matches LiveSync's typical edit-batch cadence — sub-second is overkill
 * for a personal vault, multi-second is noticeable.
 */
export const changesConfig = Config.all({
  debounceMs: Config.integer("CHANGES_DEBOUNCE_MS").pipe(Config.withDefault(2000)),
});
