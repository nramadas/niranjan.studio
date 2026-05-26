import { Context, type Effect } from "effect";

/**
 * The shape of the per-document-id coalescing queue. The implementation
 * (`ChangesQueueLayer`) maintains a map of pending doc ids; rapid
 * successive change events for the same id collapse into one re-embed.
 *
 * `enqueueReindex` and `enqueueDelete` schedule work; the queue's
 * internal fiber drives execution on the debounce timer.
 *
 * `drain` is invoked from the SIGTERM handler so in-flight pending work
 * has a chance to land before the process exits.
 */
export interface ChangesQueueImpl {
  readonly enqueueReindex: (docId: string) => Effect.Effect<void>;
  readonly enqueueDelete: (docId: string) => Effect.Effect<void>;
  readonly drain: () => Effect.Effect<void>;
  readonly depth: () => Effect.Effect<number>;
}

export class ChangesQueue extends Context.Tag("ChangesQueue")<ChangesQueue, ChangesQueueImpl>() {}
