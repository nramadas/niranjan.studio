import { Vault } from "@niranjan/vault-shared/couchdb";
import { Cause, Effect, Fiber, Layer, Ref } from "effect";
import type { ChunkingParameters } from "../../chunking/types.ts";
import { Embedder } from "../../embedding/Embedder";
import { VectorStore } from "../../store/VectorStore";
import { reindexNoteById } from "../../store/reindexNote";
import { ChangesQueue, type ChangesQueueImpl } from "../ChangesQueue";

interface Params {
  readonly debounceMs: number;
  readonly chunking: ChunkingParameters;
}

interface State {
  readonly pending: ReadonlyMap<string, { readonly lastSeenMs: number }>;
}

const empty: State = { pending: new Map() };

/**
 * Build the Layer providing `ChangesQueue`. The Layer:
 *
 *   1. Resolves Vault, Embedder, and VectorStore at construction time
 *      (Phase 2's SearchIndexLayer pattern). The resolved services are
 *      captured in closures inside the impl, so the impl's public methods
 *      have no remaining service requirements.
 *   2. Holds a `Ref<State>` of pending re-index targets, keyed by the
 *      CouchDB doc id (rapid successive change events for the same id
 *      collapse to one re-embed when the debounce window elapses).
 *   3. Forks a daemon fiber that wakes on a `debounceMs / 4` cadence,
 *      pulls out entries whose `lastSeenMs` is older than `debounceMs`,
 *      and runs `reindexNoteById` for each.
 *
 * Deletes are intentionally not first-class events in v1: LiveSync's
 * `deleteNote` semantics rename to `.trash/` and tombstone the original,
 * so the natural follow-up is "the trash copy gets indexed at its new
 * path; the original's chunks become orphans". Orphan cleanup is the
 * backfill's job — see scripts/vault-indexer/run-backfill.sh and
 * docs/vault-indexer/indexing-pipeline.md § "Orphan cleanup". A delete
 * event arriving here logs a warning and is otherwise ignored.
 *
 * Errors during a drain cycle are caught and logged — one failing doc
 * must never take down the queue fiber. The next change event for that
 * doc id will re-enqueue and retry naturally.
 *
 * @param params Resolved debounce + chunking config.
 * @returns      Layer providing ChangesQueue, requires Vault + Embedder + VectorStore.
 */
export const ChangesQueueLayer = (params: Params) =>
  Layer.scoped(
    ChangesQueue,
    Effect.gen(function* () {
      // Capture the services at construction. Each is provided as a
      // service back into the reindex effect below so its call stack
      // has no remaining open requirements.
      const vault = yield* Vault;
      const embedder = yield* Embedder;
      const store = yield* VectorStore;

      const ref = yield* Ref.make<State>(empty);

      const reindexClosed = (docId: string) =>
        reindexNoteById(docId, params.chunking).pipe(
          Effect.provideService(Vault, vault),
          Effect.provideService(Embedder, embedder),
          Effect.provideService(VectorStore, store),
        );

      const drainOnce = (now: number): Effect.Effect<void> =>
        Effect.gen(function* () {
          const state = yield* Ref.get(ref);
          const dueDocIds: string[] = [];
          const remaining = new Map<string, { lastSeenMs: number }>();
          for (const [docId, entry] of state.pending) {
            if (now - entry.lastSeenMs >= params.debounceMs) {
              dueDocIds.push(docId);
            } else {
              remaining.set(docId, entry);
            }
          }
          if (dueDocIds.length === 0) return;
          yield* Ref.set(ref, { pending: remaining });

          for (const docId of dueDocIds) {
            const result = yield* reindexClosed(docId).pipe(
              Effect.catchAllCause((cause) =>
                Effect.logError(`reindexNoteById(${docId}) failed: ${Cause.pretty(cause)}`).pipe(
                  Effect.as(undefined),
                ),
              ),
            );
            if (result) {
              yield* Effect.logInfo(
                `reindexed ${result.path}: +${result.newChunks} -${result.staleChunks} =${result.unchangedChunks}`,
              );
            }
          }
        });

      const tickInterval = Math.max(50, Math.floor(params.debounceMs / 4));

      const tickLoop = Effect.forever(
        Effect.sleep(`${tickInterval} millis`).pipe(Effect.zipRight(drainOnce(Date.now()))),
      );

      const fiber = yield* Effect.forkScoped(tickLoop);

      const impl: ChangesQueueImpl = {
        enqueueReindex: (docId) =>
          Ref.update(ref, (s) => {
            const next = new Map(s.pending);
            next.set(docId, { lastSeenMs: Date.now() });
            return { pending: next };
          }),
        enqueueDelete: (docId) =>
          Effect.logWarning(
            `delete event for ${docId} ignored in v1; orphan chunks will be cleaned by the next backfill`,
          ),
        drain: () =>
          Effect.gen(function* () {
            yield* drainOnce(Number.MAX_SAFE_INTEGER);
            yield* Fiber.interrupt(fiber);
          }),
        depth: () => Effect.map(Ref.get(ref), (s) => s.pending.size),
      };

      // Silence the unused-services warning when the impl above is the
      // only consumer of `vault`/`embedder`/`store` via `reindexClosed`.
      void vault;
      void embedder;
      void store;

      return impl;
    }),
  );
