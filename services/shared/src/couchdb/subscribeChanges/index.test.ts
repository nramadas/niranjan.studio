import { EventEmitter } from "node:events";
import { Effect, Fiber } from "effect";
import { describe, expect, it, vi } from "vitest";
import type { AnyDoc, ChangeEvent } from "../types.ts";
import { subscribeChanges } from "./index.ts";

const mkStubDb = () => {
  const emitter = new EventEmitter();
  const stop = vi.fn();
  return {
    db: {
      changesReader: {
        start: vi.fn(() => emitter),
        stop,
      },
    } as unknown as Parameters<typeof subscribeChanges>[0],
    emitter,
    stop,
  };
};

describe("subscribeChanges", () => {
  it("forwards change events to the callback", async () => {
    const { db, emitter } = mkStubDb();
    const events: ChangeEvent[] = [];
    const fiber = await Effect.runPromise(subscribeChanges(db, (e) => events.push(e)));
    emitter.emit("change", { id: "doc-1", seq: 42, deleted: false });
    emitter.emit("change", { id: "doc-2", seq: 43, deleted: true });
    expect(events).toEqual([
      { id: "doc-1", seq: 42, deleted: false },
      { id: "doc-2", seq: 43, deleted: true },
    ]);
    await Effect.runPromise(Fiber.interrupt(fiber));
  });

  it("calls db.changesReader.start with includeDocs:false and since:'now'", async () => {
    const { db } = mkStubDb();
    const fiber = await Effect.runPromise(subscribeChanges(db, () => {}));
    const start = (db as unknown as { changesReader: { start: ReturnType<typeof vi.fn> } })
      .changesReader.start;
    expect(start).toHaveBeenCalledWith({ includeDocs: false, since: "now" });
    await Effect.runPromise(Fiber.interrupt(fiber));
  });
});

// Ensure the imports for AnyDoc don't get tree-shaken away (consumed via type only).
const _: AnyDoc | undefined = undefined;
void _;
