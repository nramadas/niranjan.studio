import { describe, expect, it } from "vitest";
import { exportPKCS8, generateKeyPair } from "jose";
import { Effect, Exit, Redacted } from "effect";
import { handleAuthorize } from "./index.ts";
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
  googleStateTtlSeconds: 600,
};

const goodQuery = {
  response_type: "code",
  client_id: "client-1",
  redirect_uri: "https://claude.ai/api/mcp/auth_callback",
  code_challenge: "abcd",
  code_challenge_method: "S256",
  state: "claude-state",
};

describe("handleAuthorize", () => {
  it("redirects to Google with our state JWT", async () => {
    const layer = await mkLayer();
    const out = await Effect.runPromise(handleAuthorize(goodQuery, deps).pipe(Effect.provide(layer)));
    expect(out.kind).toBe("redirect");
    if (out.kind === "redirect") {
      const url = new URL(out.location);
      expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
      expect(url.searchParams.get("client_id")).toBe(deps.googleClientId);
      expect(url.searchParams.get("redirect_uri")).toBe(deps.googleRedirectUri);
      expect(url.searchParams.get("response_type")).toBe("code");
      expect(typeof url.searchParams.get("state")).toBe("string");
    }
  });

  it("rejects non-code response_type", async () => {
    const layer = await mkLayer();
    const exit = await Effect.runPromiseExit(
      handleAuthorize({ ...goodQuery, response_type: "token" }, deps).pipe(Effect.provide(layer)),
    );
    expect(Exit.isFailure(exit)).toBe(true);
  });

  it("rejects missing PKCE", async () => {
    const layer = await mkLayer();
    const exit = await Effect.runPromiseExit(
      handleAuthorize({ ...goodQuery, code_challenge: undefined }, deps).pipe(
        Effect.provide(layer),
      ),
    );
    expect(Exit.isFailure(exit)).toBe(true);
  });

  it("rejects PKCE method other than S256", async () => {
    const layer = await mkLayer();
    const exit = await Effect.runPromiseExit(
      handleAuthorize({ ...goodQuery, code_challenge_method: "plain" }, deps).pipe(
        Effect.provide(layer),
      ),
    );
    expect(Exit.isFailure(exit)).toBe(true);
  });

  it("rejects missing state", async () => {
    const layer = await mkLayer();
    const exit = await Effect.runPromiseExit(
      handleAuthorize({ ...goodQuery, state: undefined }, deps).pipe(Effect.provide(layer)),
    );
    expect(Exit.isFailure(exit)).toBe(true);
  });
});
