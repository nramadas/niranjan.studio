import { describe, expect, it } from "vitest";
import { exportPKCS8, generateKeyPair } from "jose";
import { Effect, Exit, Redacted } from "effect";
import { decodeAuthorizationCode } from "./index.ts";
import { encodeAuthorizationCode } from "../encodeAuthorizationCode";
import { encodeAccessToken } from "../encodeAccessToken";
import { SigningKeyLayer } from "../SigningKeyLayer";

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

const goodPayload = {
  email: "user@example.com",
  client_id: "client-1",
  redirect_uri: "https://claude.ai/api/mcp/auth_callback",
  code_challenge: "abcd",
  code_challenge_method: "S256",
};

describe("decodeAuthorizationCode", () => {
  it("round-trips a valid code", async () => {
    const layer = await mkLayer();
    const out = await Effect.runPromise(
      Effect.gen(function* () {
        const jwt = yield* encodeAuthorizationCode({ payload: goodPayload, ttlSeconds: 60 });
        return yield* decodeAuthorizationCode(jwt);
      }).pipe(Effect.provide(layer)),
    );
    expect(out.email).toBe("user@example.com");
    expect(out.code_challenge).toBe("abcd");
  });

  it("rejects a token of the wrong type (access token presented as code)", async () => {
    const layer = await mkLayer();
    const exit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const jwt = yield* encodeAccessToken({
          email: "user@example.com",
          issuer: "https://mcp.test",
          audience: "https://mcp.test",
          ttlSeconds: 60,
        });
        return yield* decodeAuthorizationCode(jwt);
      }).pipe(Effect.provide(layer)),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) expect(JSON.stringify(exit.cause)).toContain("wrong token type");
  });

  it("rejects a tampered or unsigned token", async () => {
    const layer = await mkLayer();
    const exit = await Effect.runPromiseExit(
      decodeAuthorizationCode("not.a.real.token").pipe(Effect.provide(layer)),
    );
    expect(Exit.isFailure(exit)).toBe(true);
  });
});
