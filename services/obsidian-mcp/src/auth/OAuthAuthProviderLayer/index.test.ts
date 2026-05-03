import { describe, expect, it } from "vitest";
import { exportPKCS8, generateKeyPair } from "jose";
import { Effect, Exit, Layer, Redacted } from "effect";
import { OAuthAuthProviderLayer } from "./index.ts";
import { AuthProvider } from "../AuthProvider";
import type { AuthRequest } from "../types.ts";
import { encodeAccessToken } from "../../oauth/encodeAccessToken";
import { encodeRefreshToken } from "../../oauth/encodeRefreshToken";
import { SigningKey } from "../../oauth/SigningKey";
import { SigningKeyLayer } from "../../oauth/SigningKeyLayer";

const ISS = "https://mcp.test";

const mkLayers = async () => {
  const { privateKey } = await generateKeyPair("RS256", { modulusLength: 2048, extractable: true });
  const pem = await exportPKCS8(privateKey);
  const signing = SigningKeyLayer({
    signingKeyPem: Redacted.make(pem),
    issuer: ISS,
    accessTokenTtlSeconds: 60,
    refreshTokenTtlSeconds: 60,
    authorizationCodeTtlSeconds: 60,
    googleStateTtlSeconds: 60,
  });
  const auth = OAuthAuthProviderLayer({ issuer: ISS, audience: ISS }).pipe(Layer.provide(signing));
  return Layer.provideMerge(auth, signing);
};

const mkReq = (auth?: string): AuthRequest => ({
  header: (n) => (n.toLowerCase() === "authorization" ? auth : undefined),
  path: "/mcp",
  method: "POST",
});

describe("OAuthAuthProviderLayer", () => {
  it("provides an AuthProvider with the oauth name", async () => {
    const layer = await mkLayers();
    const name = await Effect.runPromise(
      Effect.gen(function* () {
        const p = yield* AuthProvider;
        return p.name;
      }).pipe(Effect.provide(layer)),
    );
    expect(name).toBe("oauth");
  });

  it("accepts a valid access token and returns an Identity", async () => {
    const layer = await mkLayers();
    const out = await Effect.runPromise(
      Effect.gen(function* () {
        const sk = yield* SigningKey;
        const token = yield* encodeAccessToken({
          email: "user@example.com",
          issuer: ISS,
          audience: ISS,
          ttlSeconds: 60,
        }).pipe(Effect.provideService(SigningKey, sk));
        const p = yield* AuthProvider;
        return yield* p.validateRequest(mkReq(`Bearer ${token}`));
      }).pipe(Effect.provide(layer)),
    );
    expect(out.email).toBe("user@example.com");
    expect(out.source).toBe("oauth");
  });

  it("rejects a refresh token presented at /mcp", async () => {
    const layer = await mkLayers();
    const exit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const sk = yield* SigningKey;
        const token = yield* encodeRefreshToken({
          email: "user@example.com",
          issuer: ISS,
          audience: ISS,
          ttlSeconds: 60,
        }).pipe(Effect.provideService(SigningKey, sk));
        const p = yield* AuthProvider;
        return yield* p.validateRequest(mkReq(`Bearer ${token}`));
      }).pipe(Effect.provide(layer)),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) expect(JSON.stringify(exit.cause)).toContain("AuthError");
  });

  it("rejects a missing Authorization header", async () => {
    const layer = await mkLayers();
    const exit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const p = yield* AuthProvider;
        return yield* p.validateRequest(mkReq(undefined));
      }).pipe(Effect.provide(layer)),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) expect(JSON.stringify(exit.cause)).toContain("missing or malformed");
  });
});
