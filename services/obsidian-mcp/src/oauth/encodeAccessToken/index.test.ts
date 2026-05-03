import { describe, expect, it } from "vitest";
import { exportPKCS8, generateKeyPair, decodeJwt } from "jose";
import { Effect, Redacted } from "effect";
import { encodeAccessToken } from "./index.ts";
import { SigningKeyLayer } from "../SigningKeyLayer";

const mkLayer = async () => {
  const { privateKey } = await generateKeyPair("RS256", { modulusLength: 2048, extractable: true });
  const pem = await exportPKCS8(privateKey);
  return SigningKeyLayer({
    signingKeyPem: Redacted.make(pem),
    issuer: "https://mcp.test",
    accessTokenTtlSeconds: 60,
    refreshTokenTtlSeconds: 60,
    authorizationCodeTtlSeconds: 60,
    googleStateTtlSeconds: 60,
  });
};

describe("encodeAccessToken", () => {
  it("signs a JWT carrying sub/iss/aud and the access_token type discriminator", async () => {
    const layer = await mkLayer();
    const jwt = await Effect.runPromise(
      encodeAccessToken({
        email: "user@example.com",
        issuer: "https://mcp.test",
        audience: "https://mcp.test",
        ttlSeconds: 60,
      }).pipe(Effect.provide(layer)),
    );
    const claims = decodeJwt(jwt) as Record<string, unknown>;
    expect(claims.type).toBe("access_token");
    expect(claims.sub).toBe("user@example.com");
    expect(claims.iss).toBe("https://mcp.test");
    expect(claims.aud).toBe("https://mcp.test");
    expect((claims.exp as number) - (claims.iat as number)).toBe(60);
  });
});
