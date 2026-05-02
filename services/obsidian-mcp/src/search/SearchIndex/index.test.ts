import { describe, expect, it } from "vitest";
import { Effect, Layer } from "effect";
import { SearchIndex } from "./index.ts";

describe("SearchIndex", () => {
  it("acts as a Context tag — provided implementations are recoverable", async () => {
    const layer = Layer.succeed(SearchIndex, {
      query: () => Effect.succeed([{ path: "x.md", title: "x", score: 1, snippet: "hit" }]),
      markDirty: () => Effect.void,
    });
    const out = await Effect.runPromise(
      Effect.gen(function* () {
        const idx = yield* SearchIndex;
        return yield* idx.query("anything", 5);
      }).pipe(Effect.provide(layer)),
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.path).toBe("x.md");
  });
});
