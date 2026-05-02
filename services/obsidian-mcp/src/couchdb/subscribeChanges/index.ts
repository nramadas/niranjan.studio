import { Effect, Fiber, Schedule } from "effect";
import type nano from "nano";
import { ChangesFeedError } from "../../lib/errors/ChangesFeedError";
import type { AnyDoc, ChangeEvent } from "../types.ts";

/**
 * Subscribe to CouchDB's continuous `_changes` feed. The provided
 * callback fires once per change event; the search index uses this to
 * mark itself dirty (and trigger a debounced rebuild). Reconnects
 * automatically with capped exponential backoff on transport errors.
 *
 * @param db       The nano DocumentScope, taken from `couchClient.raw()`.
 * @param onChange Callback invoked synchronously for each event.
 * @returns        An Effect that yields the daemon fiber driving the
 *                 subscription. The caller does NOT need to await it —
 *                 it is forked in the background and runs for the life
 *                 of the process.
 */
export const subscribeChanges = (
  db: nano.DocumentScope<AnyDoc>,
  onChange: (e: ChangeEvent) => void,
): Effect.Effect<Fiber.RuntimeFiber<never, ChangesFeedError>, never> => {
  const oneCycle = Effect.async<void, ChangesFeedError>((resume) => {
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

  const retried = oneCycle.pipe(
    Effect.tapError((err) => Effect.logWarning(`changes feed error: ${err.message}`)),
    Effect.retry(
      Schedule.exponential("1 second", 2).pipe(
        Schedule.compose(Schedule.elapsed),
        Schedule.upTo("60 seconds"),
      ),
    ),
  );

  return Effect.forkDaemon(retried) as Effect.Effect<
    Fiber.RuntimeFiber<never, ChangesFeedError>,
    never
  >;
};
