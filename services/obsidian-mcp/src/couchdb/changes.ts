// Subscription to CouchDB's continuous _changes feed. Used to invalidate
// the in-memory search index when the vault is mutated by Obsidian
// clients. Keeps a single long-lived HTTP connection; reconnects with
// exponential backoff on failure.
//
// We listen with `feed=continuous&since=now&include_docs=false` — we only
// need to know that *something* changed, not what changed. The search
// index then triggers a debounced rebuild.

import { Effect, Fiber, Schedule } from "effect";
import nano from "nano";
import type { AnyDoc } from "./types.js";
import { ChangesFeedError } from "../lib/errors.js";

export interface ChangeEvent {
  readonly id: string;
  readonly seq: string | number;
  readonly deleted?: boolean;
}

export const subscribeChanges = (
  db: nano.DocumentScope<AnyDoc>,
  onChange: (e: ChangeEvent) => void,
): Effect.Effect<Fiber.RuntimeFiber<never, ChangesFeedError>, never> => {
  const oneCycle = Effect.async<void, ChangesFeedError>((resume) => {
    // nano's changesReader runs as a long-poll loop; .start() defaults to
    // since="now" + continuous-style emissions via the EventEmitter.
    const stream = db.changesReader.start({
      includeDocs: false,
      since: "now",
    });
    stream.on("change", (change: { id: string; seq: string | number; deleted?: boolean }) => {
      onChange({
        id: change.id,
        seq: change.seq,
        deleted: change.deleted === true,
      });
    });
    stream.on("error", (err: Error) => {
      resume(Effect.fail(new ChangesFeedError({ message: err.message, cause: err })));
    });
    stream.on("end", () => {
      resume(Effect.fail(new ChangesFeedError({ message: "changes feed ended unexpectedly" })));
    });
    return Effect.sync(() => db.changesReader.stop());
  });

  // Reconnect on failure, capped exponential backoff. Each reconnect is
  // logged so an operator notices if we're flapping.
  const retried = oneCycle.pipe(
    Effect.tapError((err) => Effect.logWarning(`changes feed error: ${err.message}`)),
    Effect.retry(
      Schedule.exponential("1 second", 2).pipe(Schedule.compose(Schedule.elapsed), Schedule.upTo("60 seconds")),
    ),
  );

  return Effect.forkDaemon(retried) as Effect.Effect<
    Fiber.RuntimeFiber<never, ChangesFeedError>,
    never
  >;
};
