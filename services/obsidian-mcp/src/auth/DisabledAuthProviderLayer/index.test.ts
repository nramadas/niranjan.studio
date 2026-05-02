import { describe, expect, it } from "vitest";
import { Effect, Exit, Redacted } from "effect";
import { DisabledAuthProviderLayer } from "./index.ts";
import { AuthProvider } from "../AuthProvider";
import type { AuthRequest } from "../types.ts";

const bearer = Redacted.make("dev-token");
const layer = DisabledAuthProviderLayer(bearer);

const mkReq = (auth?: string): AuthRequest => ({
  header: (name) => (name === "authorization" ? auth : undefined),
  path: "/mcp",
  method: "POST",
});

describe("DisabledAuthProviderLayer", () => {
  it("returns a local-dev identity when the bearer matches", async () => {
    const id = await Effect.runPromise(
      Effect.gen(function* () {
        const p = yield* AuthProvider;
        return yield* p.validateRequest(mkReq("Bearer dev-token"));
      }).pipe(Effect.provide(layer)),
    );
    expect(id.email).toBe("local-dev");
    expect(id.source).toBe("disabled");
  });

  it("still rejects when the bearer is missing", async () => {
    const exit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const p = yield* AuthProvider;
        return yield* p.validateRequest(mkReq(undefined));
      }).pipe(Effect.provide(layer)),
    );
    expect(Exit.isFailure(exit)).toBe(true);
  });
});
