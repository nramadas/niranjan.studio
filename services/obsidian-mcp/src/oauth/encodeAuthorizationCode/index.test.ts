import { Effect, Redacted } from "effect";
import { decodeJwt, exportPKCS8, generateKeyPair } from "jose";
import { describe, expect, it } from "vitest";
import { SigningKeyLayer } from "../SigningKeyLayer";
import { encodeAuthorizationCode } from "./index.ts";

const mkLayer = async () => {
  const { privateKey } = await generateKeyPair("RS256", { modulusLength: 2048, extractable: true });
  const pem = await exportPKCS8(privateKey);
  return SigningKeyLayer({
    signingKeyPem: Redacted.make(pem),
    issuer: "https://mcp.test",
    accessTokenTtlSeconds: 3600,
    refreshTokenTtlSeconds: 60,
    authorizationCodeTtlSeconds: 60,
    googleStateTtlSeconds: 60,
  });
};

describe("encodeAuthorizationCode", () => {
  it("signs a JWT carrying the code payload + type discriminator", async () => {
    const layer = await mkLayer();
    const jwt = await Effect.runPromise(
      encodeAuthorizationCode({
        payload: {
          email: "user@example.com",
          client_id: "client-1",
          redirect_uri: "https://claude.ai/api/mcp/auth_callback",
          code_challenge: "abcd",
          code_challenge_method: "S256",
        },
        ttlSeconds: 60,
      }).pipe(Effect.provide(layer)),
    );
    const claims = decodeJwt(jwt) as Record<string, unknown>;
    expect(claims.type).toBe("authorization_code");
    expect(claims.email).toBe("user@example.com");
    expect(claims.client_id).toBe("client-1");
    expect(claims.code_challenge).toBe("abcd");
    expect(typeof claims.exp).toBe("number");
    expect((claims.exp as number) - (claims.iat as number)).toBe(60);
  });
});
