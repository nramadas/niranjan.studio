import { describe, expect, it } from "vitest";
import { exportPKCS8, generateKeyPair } from "jose";
import { Effect, Exit, Redacted } from "effect";
import { decodeAccessToken } from "./index.ts";
import { encodeAccessToken } from "../encodeAccessToken";
import { encodeRefreshToken } from "../encodeRefreshToken";
import { SigningKeyLayer } from "../SigningKeyLayer";

const ISS = "https://mcp.test";

const mkLayer = async () => {
  const { privateKey } = await generateKeyPair("RS256", { modulusLength: 2048, extractable: true });
  const pem = await exportPKCS8(privateKey);
  return SigningKeyLayer({
    signingKeyPem: Redacted.make(pem),
    issuer: ISS,
    accessTokenTtlSeconds: 60,
    refreshTokenTtlSeconds: 60,
    authorizationCodeTtlSeconds: 60,
    googleStateTtlSeconds: 60,
  });
};

describe("decodeAccessToken", () => {
  it("round-trips a valid access token", async () => {
    const layer = await mkLayer();
    const out = await Effect.runPromise(
      Effect.gen(function* () {
        const jwt = yield* encodeAccessToken({
          email: "user@example.com",
          issuer: ISS,
          audience: ISS,
          ttlSeconds: 60,
        });
        return yield* decodeAccessToken(jwt, ISS, ISS);
      }).pipe(Effect.provide(layer)),
    );
    expect(out.sub).toBe("user@example.com");
  });

  it("rejects a refresh token presented as an access token", async () => {
    const layer = await mkLayer();
    const exit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const jwt = yield* encodeRefreshToken({
          email: "user@example.com",
          issuer: ISS,
          audience: ISS,
          ttlSeconds: 60,
        });
        return yield* decodeAccessToken(jwt, ISS, ISS);
      }).pipe(Effect.provide(layer)),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) expect(JSON.stringify(exit.cause)).toContain("wrong token type");
  });

  it("rejects an access token with the wrong issuer", async () => {
    const layer = await mkLayer();
    const exit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const jwt = yield* encodeAccessToken({
          email: "u",
          issuer: "https://wrong.test",
          audience: ISS,
          ttlSeconds: 60,
        });
        return yield* decodeAccessToken(jwt, ISS, ISS);
      }).pipe(Effect.provide(layer)),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) expect(JSON.stringify(exit.cause)).toContain("unexpected issuer");
  });
});
