import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";
import { AuthProvider } from "./index.ts";

describe("AuthProvider", () => {
  it("acts as a Context tag — provided implementations are recoverable from a layer", async () => {
    const stub = Layer.succeed(AuthProvider, {
      name: "stub",
      validateRequest: () => Effect.succeed({ email: "user@example.com", source: "stub" }),
    });
    const out = await Effect.runPromise(
      Effect.gen(function* () {
        const p = yield* AuthProvider;
        return p.name;
      }).pipe(Effect.provide(stub)),
    );
    expect(out).toBe("stub");
  });
});
