import { describe, expect, it } from "vitest";
import { exportPKCS8, generateKeyPair } from "jose";
import { Effect, Exit, Redacted } from "effect";
import { decodeGoogleState } from "./index.ts";
import { encodeGoogleState } from "../encodeGoogleState";
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
    googleStateTtlSeconds: 600,
  });
};

const goodPayload = {
  client_id: "client-1",
  redirect_uri: "https://claude.ai/api/mcp/auth_callback",
  code_challenge: "abcd",
  code_challenge_method: "S256",
  mcp_state: "claude-state",
};

describe("decodeGoogleState", () => {
  it("round-trips a valid state", async () => {
    const layer = await mkLayer();
    const out = await Effect.runPromise(
      Effect.gen(function* () {
        const jwt = yield* encodeGoogleState({ payload: goodPayload, ttlSeconds: 600 });
        return yield* decodeGoogleState(jwt);
      }).pipe(Effect.provide(layer)),
    );
    expect(out.mcp_state).toBe("claude-state");
    expect(out.code_challenge).toBe("abcd");
  });

  it("rejects a tampered state", async () => {
    const layer = await mkLayer();
    const exit = await Effect.runPromiseExit(
      decodeGoogleState("not.a.real.token").pipe(Effect.provide(layer)),
    );
    expect(Exit.isFailure(exit)).toBe(true);
  });
});
