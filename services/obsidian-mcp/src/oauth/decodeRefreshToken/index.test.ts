import { Effect, Exit, Redacted } from "effect";
import { exportPKCS8, generateKeyPair } from "jose";
import { describe, expect, it } from "vitest";
import { SigningKeyLayer } from "../SigningKeyLayer";
import { encodeAccessToken } from "../encodeAccessToken";
import { encodeRefreshToken } from "../encodeRefreshToken";
import { decodeRefreshToken } from "./index.ts";

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

describe("decodeRefreshToken", () => {
  it("round-trips a valid refresh token", async () => {
    const layer = await mkLayer();
    const out = await Effect.runPromise(
      Effect.gen(function* () {
        const jwt = yield* encodeRefreshToken({
          email: "user@example.com",
          issuer: ISS,
          audience: ISS,
          ttlSeconds: 60,
        });
        return yield* decodeRefreshToken(jwt, ISS, ISS);
      }).pipe(Effect.provide(layer)),
    );
    expect(out.sub).toBe("user@example.com");
  });

  it("rejects an access token presented as a refresh token", async () => {
    const layer = await mkLayer();
    const exit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const jwt = yield* encodeAccessToken({
          email: "user@example.com",
          issuer: ISS,
          audience: ISS,
          ttlSeconds: 60,
        });
        return yield* decodeRefreshToken(jwt, ISS, ISS);
      }).pipe(Effect.provide(layer)),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) expect(JSON.stringify(exit.cause)).toContain("wrong token type");
  });
});
