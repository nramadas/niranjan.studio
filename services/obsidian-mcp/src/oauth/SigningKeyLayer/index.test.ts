import { Effect, Redacted } from "effect";
import { exportPKCS8, generateKeyPair } from "jose";
import { describe, expect, it } from "vitest";
import { SigningKey } from "../SigningKey";
import { SigningKeyLayer } from "./index.ts";

const mkCfg = async () => {
  const { privateKey } = await generateKeyPair("RS256", { modulusLength: 2048, extractable: true });
  const pem = await exportPKCS8(privateKey);
  return {
    signingKeyPem: Redacted.make(pem),
    issuer: "https://mcp.test",
    accessTokenTtlSeconds: 3600,
    refreshTokenTtlSeconds: 60 * 60 * 24 * 30,
    authorizationCodeTtlSeconds: 60,
    googleStateTtlSeconds: 600,
  };
};

describe("SigningKeyLayer", () => {
  it("loads the PEM and exposes a public JWK with kid + alg + use", async () => {
    const cfg = await mkCfg();
    const out = await Effect.runPromise(
      Effect.gen(function* () {
        const k = yield* SigningKey;
        return { kid: k.kid, jwk: k.publicJwk };
      }).pipe(Effect.provide(SigningKeyLayer(cfg))),
    );
    expect(out.kid).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(out.jwk.alg).toBe("RS256");
    expect(out.jwk.use).toBe("sig");
    expect(out.jwk.kid).toBe(out.kid);
    expect(out.jwk.kty).toBe("RSA");
    // No private fields leaked.
    for (const f of ["d", "p", "q", "dp", "dq", "qi"]) {
      expect((out.jwk as Record<string, unknown>)[f]).toBeUndefined();
    }
  });

  it("round-trips a JWT through sign + verify", async () => {
    const cfg = await mkCfg();
    const out = await Effect.runPromise(
      Effect.gen(function* () {
        const k = yield* SigningKey;
        const jwt = yield* k.sign(
          { sub: "user@example.com", scope: "test" },
          { expiresInSeconds: 60 },
        );
        return yield* k.verify(jwt);
      }).pipe(Effect.provide(SigningKeyLayer(cfg))),
    );
    expect(out.sub).toBe("user@example.com");
    expect(out.scope).toBe("test");
    expect(typeof out.exp).toBe("number");
    expect(typeof out.iat).toBe("number");
  });

  it("fails verification on a tampered JWT", async () => {
    const cfg = await mkCfg();
    const exit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const k = yield* SigningKey;
        const jwt = yield* k.sign({ sub: "x" }, { expiresInSeconds: 60 });
        // Flip a byte in the MIDDLE of the signature segment, not the
        // last character. The last base64url character of an RS256
        // signature carries only 2 significant bits (4 padding bits
        // get masked by the decoder), so tampering there is sometimes a
        // no-op — flaky. The midpoint character is fully significant.
        const parts = jwt.split(".");
        const sig = parts[2] ?? "";
        const mid = Math.floor(sig.length / 2);
        const oldChar = sig[mid] ?? "A";
        const newChar = oldChar === "A" ? "B" : "A";
        const tampered = `${parts[0]}.${parts[1]}.${sig.slice(0, mid)}${newChar}${sig.slice(mid + 1)}`;
        return yield* k.verify(tampered);
      }).pipe(Effect.provide(SigningKeyLayer(cfg))),
    );
    expect(exit._tag).toBe("Failure");
  });
});
