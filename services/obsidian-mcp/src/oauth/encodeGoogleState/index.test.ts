import { Effect, Redacted } from "effect";
import { decodeJwt, exportPKCS8, generateKeyPair } from "jose";
import { describe, expect, it } from "vitest";
import { SigningKeyLayer } from "../SigningKeyLayer";
import { encodeGoogleState } from "./index.ts";

describe("encodeGoogleState", () => {
  it("signs a JWT carrying the resumption payload + google_state type", async () => {
    const { privateKey } = await generateKeyPair("RS256", {
      modulusLength: 2048,
      extractable: true,
    });
    const pem = await exportPKCS8(privateKey);
    const layer = SigningKeyLayer({
      signingKeyPem: Redacted.make(pem),
      issuer: "https://mcp.test",
      accessTokenTtlSeconds: 60,
      refreshTokenTtlSeconds: 60,
      authorizationCodeTtlSeconds: 60,
      googleStateTtlSeconds: 600,
    });
    const jwt = await Effect.runPromise(
      encodeGoogleState({
        payload: {
          client_id: "client-1",
          redirect_uri: "https://claude.ai/api/mcp/auth_callback",
          code_challenge: "abcd",
          code_challenge_method: "S256",
          mcp_state: "claude-state",
        },
        ttlSeconds: 600,
      }).pipe(Effect.provide(layer)),
    );
    const claims = decodeJwt(jwt) as Record<string, unknown>;
    expect(claims.type).toBe("google_state");
    expect(claims.mcp_state).toBe("claude-state");
    expect(claims.code_challenge).toBe("abcd");
  });
});
