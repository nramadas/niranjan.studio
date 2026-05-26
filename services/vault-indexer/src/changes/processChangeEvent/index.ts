import { isIndexablePath } from "@niranjan/vault-shared/lib/isIndexablePath";
import { Effect } from "effect";

interface ChangeLike {
  readonly id: string;
  readonly deleted?: boolean;
}

/**
 * Classify a single `_changes` event into one of three actions:
 *   - reindex: a note doc was created/updated; enqueue it.
 *   - delete:  the note doc has `deleted: true`; remove its chunks.
 *   - skip:    a chunk doc, a system doc, a tombstoned non-note doc, an
 *              excluded folder (e.g. `.trash/`), etc.
 *
 * Chunk docs (`h:` / `h:+` prefix), CouchDB system docs (`_local/` etc.,
 * `_design/`) and LiveSync internal docs (`i:`) never carry note content
 * and so never need re-embedding.
 *
 * Excluded folders (see lib/isIndexablePath) — `.trash/` is currently
 * the only entry — are skipped for BOTH reindex and delete. Reindex
 * skipping is the obvious case. Delete skipping is also correct: if we
 * never indexed a `.trash/` note, there are no chunks for it in the
 * store, so a delete event is a no-op anyway; skipping early avoids
 * unnecessary queue churn.
 *
 * The function does not perform the work — it only decides. The queue
 * (`ChangesQueue.enqueue`) drives the actual reindex/delete.
 *
 * @param event Event payload from `subscribeChanges`.
 * @returns     The action plus, for reindex, the id the caller should resolve to a path.
 */
export const processChangeEvent = (event: ChangeLike): Effect.Effect<Action> =>
  Effect.sync(() => {
    const id = event.id;
    if (id.startsWith("h:") || id.startsWith("_") || id.startsWith("i:")) {
      return { kind: "skip" as const, reason: `non-note doc id prefix: ${id.slice(0, 2)}` };
    }
    // LiveSync's doc id IS the note path. We can apply the same
    // exclusion the backfill uses (lib/isIndexablePath) without having
    // to resolve the doc first.
    if (!isIndexablePath(id)) {
      return { kind: "skip" as const, reason: `excluded path prefix: ${id}` };
    }
    if (event.deleted === true) {
      return { kind: "delete" as const, docId: id };
    }
    return { kind: "reindex" as const, docId: id };
  });

export type Action =
  | { readonly kind: "reindex"; readonly docId: string }
  | { readonly kind: "delete"; readonly docId: string }
  | { readonly kind: "skip"; readonly reason: string };
