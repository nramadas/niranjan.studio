import { describe, expect, it } from "vitest";
import { Effect, Layer, ManagedRuntime } from "effect";
import { searchNotes } from "./index.ts";
import { SearchIndex } from "../../../search/SearchIndex";

describe("searchNotes tool", () => {
  it("invokes SearchIndex.query with the supplied query and limit", async () => {
    const calls: { q: string; limit: number }[] = [];
    const layer = Layer.succeed(SearchIndex, {
      query: (q, limit) => {
        calls.push({ q, limit });
        return Effect.succeed([{ path: "x.md", title: "x", score: 1, snippet: "snip" }]);
      },
      markDirty: () => Effect.void,
    });
    const runtime = ManagedRuntime.make(layer);
    const inner = await runtime.runtime();
    const result = await searchNotes(inner as never).handler({ query: "hello", limit: 7 });
    expect(calls).toEqual([{ q: "hello", limit: 7 }]);
    const items = (result.structuredContent as { items: unknown[] }).items;
    expect(items).toHaveLength(1);
  });

  it("defaults limit to 10 when omitted", async () => {
    const calls: { q: string; limit: number }[] = [];
    const layer = Layer.succeed(SearchIndex, {
      query: (q, limit) => {
        calls.push({ q, limit });
        return Effect.succeed([]);
      },
      markDirty: () => Effect.void,
    });
    const runtime = ManagedRuntime.make(layer);
    const inner = await runtime.runtime();
    await searchNotes(inner as never).handler({ query: "x" });
    expect(calls[0]?.limit).toBe(10);
  });
});
