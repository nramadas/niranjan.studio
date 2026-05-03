import { createHash, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { Effect, Exit } from "effect";
import { verifyPkce } from "./index.ts";

const mkPair = () => {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
};

describe("verifyPkce", () => {
  it("succeeds when SHA256(verifier) == challenge with S256", async () => {
    const { verifier, challenge } = mkPair();
    const exit = await Effect.runPromiseExit(verifyPkce(verifier, challenge, "S256"));
    expect(Exit.isSuccess(exit)).toBe(true);
  });

  it("rejects an unknown method", async () => {
    const { verifier, challenge } = mkPair();
    const exit = await Effect.runPromiseExit(verifyPkce(verifier, challenge, "plain"));
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) expect(JSON.stringify(exit.cause)).toContain("unsupported PKCE method");
  });

  it("rejects a missing verifier", async () => {
    const { challenge } = mkPair();
    const exit = await Effect.runPromiseExit(verifyPkce("", challenge, "S256"));
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) expect(JSON.stringify(exit.cause)).toContain("missing code_verifier");
  });

  it("rejects a verifier that's too short", async () => {
    const exit = await Effect.runPromiseExit(verifyPkce("x".repeat(20), "c", "S256"));
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) expect(JSON.stringify(exit.cause)).toContain("length out of range");
  });

  it("rejects a mismatched challenge", async () => {
    const { verifier } = mkPair();
    const wrong = createHash("sha256").update("not-the-verifier").digest("base64url");
    const exit = await Effect.runPromiseExit(verifyPkce(verifier, wrong, "S256"));
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) expect(JSON.stringify(exit.cause)).toContain("PKCE verification failed");
  });
});
