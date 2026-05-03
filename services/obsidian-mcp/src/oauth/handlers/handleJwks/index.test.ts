import { describe, expect, it } from "vitest";
import { exportPKCS8, generateKeyPair } from "jose";
import { Effect, Redacted } from "effect";
import { handleJwks } from "./index.ts";
import { SigningKeyLayer } from "../../SigningKeyLayer";

describe("handleJwks", () => {
  it("returns a JWKS containing the public JWK", async () => {
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
      googleStateTtlSeconds: 60,
    });
    const out = await Effect.runPromise(handleJwks().pipe(Effect.provide(layer)));
    expect(out.kind).toBe("json");
    if (out.kind === "json") {
      expect(out.status).toBe(200);
      const body = out.body as { keys: Array<{ alg?: string; use?: string; kid?: string; kty?: string }> };
      expect(body.keys).toHaveLength(1);
      expect(body.keys[0]?.alg).toBe("RS256");
      expect(body.keys[0]?.use).toBe("sig");
      expect(body.keys[0]?.kty).toBe("RSA");
      expect(typeof body.keys[0]?.kid).toBe("string");
    }
  });
});
