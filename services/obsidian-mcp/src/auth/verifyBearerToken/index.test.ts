import { describe, expect, it } from "vitest";
import { Effect, Exit, Redacted } from "effect";
import { verifyBearerToken } from "./index.ts";
import type { AuthRequest } from "../types.ts";

const mkReq = (auth?: string): AuthRequest => ({
  header: (name) => (name === "authorization" ? auth : undefined),
  path: "/mcp",
  method: "POST",
});

const expected = Redacted.make("expected-token");

describe("verifyBearerToken", () => {
  it("succeeds when the header matches", async () => {
    const exit = await Effect.runPromiseExit(
      verifyBearerToken(mkReq("Bearer expected-token"), expected),
    );
    expect(Exit.isSuccess(exit)).toBe(true);
  });

  it("fails 401 when the header is missing", async () => {
    const exit = await Effect.runPromiseExit(verifyBearerToken(mkReq(undefined), expected));
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      const failure = exit.cause;
      const text = JSON.stringify(failure);
      expect(text).toContain("AuthError");
      expect(text).toContain("401");
    }
  });

  it("fails 401 when the header is not a Bearer token", async () => {
    const exit = await Effect.runPromiseExit(verifyBearerToken(mkReq("Basic abcdef"), expected));
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(JSON.stringify(exit.cause)).toContain("401");
    }
  });

  it("fails 403 when the bearer token is present but mismatched", async () => {
    const exit = await Effect.runPromiseExit(verifyBearerToken(mkReq("Bearer wrong"), expected));
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(JSON.stringify(exit.cause)).toContain("403");
    }
  });
});
