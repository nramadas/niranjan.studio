import { describe, expect, it } from "vitest";
import { Effect, Exit, Redacted } from "effect";
import { CloudflareAccessAuthProviderLayer } from "./index.ts";
import { AuthProvider } from "../AuthProvider";
import type { AuthRequest } from "../types.ts";

const cfg = {
  teamDomain: "team.cloudflareaccess.com",
  aud: "audience-tag",
  bearerToken: Redacted.make("bearer-secret"),
};

const mkReq = (headers: Record<string, string>): AuthRequest => ({
  header: (name) => headers[name.toLowerCase()],
  path: "/mcp",
  method: "POST",
});

describe("CloudflareAccessAuthProviderLayer", () => {
  it("provides an AuthProvider with the cloudflare-access name", async () => {
    const name = await Effect.runPromise(
      Effect.gen(function* () {
        const p = yield* AuthProvider;
        return p.name;
      }).pipe(Effect.provide(CloudflareAccessAuthProviderLayer(cfg))),
    );
    expect(name).toBe("cloudflare-access");
  });

  it("rejects requests missing the Authorization header before any JWT/JWKS work", async () => {
    const exit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const p = yield* AuthProvider;
        return yield* p.validateRequest(mkReq({}));
      }).pipe(Effect.provide(CloudflareAccessAuthProviderLayer(cfg))),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(JSON.stringify(exit.cause)).toContain("missing Authorization header");
    }
  });

  it("rejects when the bearer matches but no Cf-Access-Jwt-Assertion is present", async () => {
    const exit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const p = yield* AuthProvider;
        return yield* p.validateRequest(mkReq({ authorization: "Bearer bearer-secret" }));
      }).pipe(Effect.provide(CloudflareAccessAuthProviderLayer(cfg))),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(JSON.stringify(exit.cause)).toContain("Missing Cf-Access-Jwt-Assertion");
    }
  });
});
