import { Effect, Layer, ManagedRuntime } from "effect";
import { describe, expect, it } from "vitest";
import { IndexerClient } from "../../../search/IndexerClient";
import { SearchIndex } from "../../../search/SearchIndex";
import { searchNotes } from "./index.ts";

// The tool now delegates to hybridSearch, which fan-outs to both
// SearchIndex (BM25) and IndexerClient (semantic) and RRFs the results.
// hybridSearch requests `limit * 2` from each arm so RRF has room to
// re-rank — these tests assert that wiring rather than a 1:1 limit
// pass-through.

const makeLayer = (
  searchHits: ReadonlyArray<{ path: string; title: string; score: number; snippet: string }>,
  capture: (q: string, limit: number) => void,
) =>
  Layer.mergeAll(
    Layer.succeed(SearchIndex, {
      query: (q, limit) => {
        capture(q, limit);
        return Effect.succeed(searchHits);
      },
      markDirty: () => Effect.void,
    }),
    Layer.succeed(IndexerClient, {
      // Indexer arm returns empty so hybridSearch falls through to
      // lexical-only ordering — the BM25 ranks one-for-one to fused output.
      search: () => Effect.succeed([]),
    }),
  );

describe("searchNotes tool", () => {
  it("passes through query and forwards a limit×2 budget to the BM25 arm", async () => {
    const calls: { q: string; limit: number }[] = [];
    const layer = makeLayer([{ path: "x.md", title: "x", score: 1, snippet: "snip" }], (q, limit) =>
      calls.push({ q, limit }),
    );
    const runtime = ManagedRuntime.make(layer);
    const inner = await runtime.runtime();
    const result = await searchNotes(inner as never).handler({ query: "hello", limit: 7 });
    expect(calls[0]?.q).toBe("hello");
    expect(calls[0]?.limit).toBe(14); // 7 × 2: see hybridSearch
    const items = (result.structuredContent as { items: unknown[] }).items;
    expect(items).toHaveLength(1);
  });

  it("defaults the tool limit to 10 → BM25 gets a budget of 20", async () => {
    const calls: { q: string; limit: number }[] = [];
    const layer = makeLayer([], (q, limit) => calls.push({ q, limit }));
    const runtime = ManagedRuntime.make(layer);
    const inner = await runtime.runtime();
    await searchNotes(inner as never).handler({ query: "x" });
    expect(calls[0]?.limit).toBe(20);
  });

  it("supports mode=lexical which skips the indexer arm", async () => {
    let indexerCalled = false;
    const layer = Layer.mergeAll(
      Layer.succeed(SearchIndex, {
        query: () => Effect.succeed([{ path: "a.md", title: "a", score: 1, snippet: "" }]),
        markDirty: () => Effect.void,
      }),
      Layer.succeed(IndexerClient, {
        search: () => {
          indexerCalled = true;
          return Effect.succeed([]);
        },
      }),
    );
    const runtime = ManagedRuntime.make(layer);
    const inner = await runtime.runtime();
    await searchNotes(inner as never).handler({ query: "x", mode: "lexical" });
    expect(indexerCalled).toBe(false);
  });
});
