import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";
import { CouchClient, type CouchClientImpl } from "./index.ts";

describe("CouchClient", () => {
  it("acts as a Context tag — provided implementations are recoverable", async () => {
    const stub: CouchClientImpl = {
      getDoc: () => Effect.succeed(undefined),
      getDocs: () => Effect.succeed([]),
      putDoc: (doc) => Effect.succeed({ ...doc, _rev: "1-stub" }),
      bulkPut: () => Effect.succeed([]),
      listNoteDocs: () => Effect.succeed([]),
      raw: () => ({}) as never,
    };
    const out = await Effect.runPromise(
      Effect.gen(function* () {
        const c = yield* CouchClient;
        return yield* c.putDoc({ _id: "x" });
      }).pipe(Effect.provide(Layer.succeed(CouchClient, stub))),
    );
    expect(out._rev).toBe("1-stub");
  });
});
