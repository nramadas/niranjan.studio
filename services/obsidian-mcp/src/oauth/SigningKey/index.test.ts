import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";
import { SigningKey } from "./index.ts";

describe("SigningKey", () => {
  it("acts as a Context tag — provided implementations are recoverable", async () => {
    const stub = Layer.succeed(SigningKey, {
      kid: "stub-kid",
      publicJwk: { kty: "RSA", n: "x", e: "AQAB" },
      sign: () => Effect.succeed("signed"),
      verify: () => Effect.succeed({}),
    });
    const out = await Effect.runPromise(
      Effect.gen(function* () {
        const k = yield* SigningKey;
        return k.kid;
      }).pipe(Effect.provide(stub)),
    );
    expect(out).toBe("stub-kid");
  });
});
