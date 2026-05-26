import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { processChangeEvent } from "./index.ts";

const run = <A>(eff: Effect.Effect<A>) => Effect.runSync(eff);

describe("processChangeEvent", () => {
  it("reindexes a normal note doc id", () => {
    const a = run(processChangeEvent({ id: "abc123" }));
    expect(a.kind).toBe("reindex");
  });

  it("skips chunk docs (h: prefix)", () => {
    const a = run(processChangeEvent({ id: "h:abc" }));
    expect(a.kind).toBe("skip");
  });

  it("skips encrypted chunk docs (h:+ prefix)", () => {
    const a = run(processChangeEvent({ id: "h:+def" }));
    expect(a.kind).toBe("skip");
  });

  it("skips system docs (_local, _design)", () => {
    expect(run(processChangeEvent({ id: "_local/anything" })).kind).toBe("skip");
    expect(run(processChangeEvent({ id: "_design/x" })).kind).toBe("skip");
  });

  it("skips LiveSync internal docs (i: prefix)", () => {
    expect(run(processChangeEvent({ id: "i:abc" })).kind).toBe("skip");
  });

  it("emits delete for tombstoned note docs", () => {
    const a = run(processChangeEvent({ id: "abc", deleted: true }));
    expect(a.kind).toBe("delete");
  });

  it("treats deleted=true on a chunk doc as skip (not delete)", () => {
    const a = run(processChangeEvent({ id: "h:abc", deleted: true }));
    expect(a.kind).toBe("skip");
  });
});
