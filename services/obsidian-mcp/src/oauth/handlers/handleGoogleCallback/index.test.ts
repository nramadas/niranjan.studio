import { describe, expect, it } from "vitest";
import { exportPKCS8, generateKeyPair } from "jose";
import { Effect, Exit, Redacted } from "effect";
import { handleGoogleCallback } from "./index.ts";
import { SigningKeyLayer } from "../../SigningKeyLayer";

const mkLayer = async () => {
  const { privateKey } = await generateKeyPair("RS256", { modulusLength: 2048, extractable: true });
  const pem = await exportPKCS8(privateKey);
  return SigningKeyLayer({
    signingKeyPem: Redacted.make(pem),
    issuer: "https://mcp.test",
    accessTokenTtlSeconds: 60,
    refreshTokenTtlSeconds: 60,
    authorizationCodeTtlSeconds: 60,
    googleStateTtlSeconds: 600,
  });
};

const deps = {
  googleClientId: "1234.apps.googleusercontent.com",
  googleClientSecret: Redacted.make("GOCSPX-secret"),
  googleRedirectUri: "https://mcp.test/oauth/google/callback",
  authorizationCodeTtlSeconds: 60,
  allowedEmails: new Set(["user@example.com"]),
};

describe("handleGoogleCallback", () => {
  it("rejects when google reports an error", async () => {
    const layer = await mkLayer();
    const exit = await Effect.runPromiseExit(
      handleGoogleCallback(
        { error: "access_denied", error_description: "user closed prompt" },
        deps,
      ).pipe(Effect.provide(layer)),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) expect(JSON.stringify(exit.cause)).toContain("google rejected sign-in");
  });

  it("rejects missing code", async () => {
    const layer = await mkLayer();
    const exit = await Effect.runPromiseExit(
      handleGoogleCallback({ state: "x" }, deps).pipe(Effect.provide(layer)),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) expect(JSON.stringify(exit.cause)).toContain("missing code");
  });

  it("rejects missing state", async () => {
    const layer = await mkLayer();
    const exit = await Effect.runPromiseExit(
      handleGoogleCallback({ code: "abc" }, deps).pipe(Effect.provide(layer)),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) expect(JSON.stringify(exit.cause)).toContain("missing state");
  });

  it("rejects an unparseable state JWT before talking to Google", async () => {
    const layer = await mkLayer();
    const exit = await Effect.runPromiseExit(
      handleGoogleCallback({ code: "abc", state: "not.a.token" }, deps).pipe(
        Effect.provide(layer),
      ),
    );
    expect(Exit.isFailure(exit)).toBe(true);
  });
});
