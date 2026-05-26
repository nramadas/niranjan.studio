import { Effect, Redacted } from "effect";
import { decodeJwt, exportPKCS8, generateKeyPair } from "jose";
import { describe, expect, it } from "vitest";
import { SigningKeyLayer } from "../SigningKeyLayer";
import { encodeRefreshToken } from "./index.ts";

describe("encodeRefreshToken", () => {
  it("signs a JWT with the refresh_token type discriminator", async () => {
    const { privateKey } = await generateKeyPair("RS256", {
      modulusLength: 2048,
      extractable: true,
    });
    const pem = await exportPKCS8(privateKey);
    const layer = SigningKeyLayer({
      signingKeyPem: Redacted.make(pem),
      issuer: "https://mcp.test",
      accessTokenTtlSeconds: 60,
      refreshTokenTtlSeconds: 60 * 60 * 24 * 30,
      authorizationCodeTtlSeconds: 60,
      googleStateTtlSeconds: 60,
    });
    const jwt = await Effect.runPromise(
      encodeRefreshToken({
        email: "user@example.com",
        issuer: "https://mcp.test",
        audience: "https://mcp.test",
        ttlSeconds: 60 * 60 * 24 * 30,
      }).pipe(Effect.provide(layer)),
    );
    const claims = decodeJwt(jwt) as Record<string, unknown>;
    expect(claims.type).toBe("refresh_token");
    expect(claims.sub).toBe("user@example.com");
  });
});
