import { createHash, randomBytes } from "node:crypto";
import { Effect, Exit, Redacted } from "effect";
import { exportPKCS8, generateKeyPair } from "jose";
import { describe, expect, it } from "vitest";
import { SigningKeyLayer } from "../../SigningKeyLayer";
import { encodeAuthorizationCode } from "../../encodeAuthorizationCode";
import { encodeRefreshToken } from "../../encodeRefreshToken";
import { handleToken } from "./index.ts";

const ISS = "https://mcp.test";

const mkLayer = async () => {
  const { privateKey } = await generateKeyPair("RS256", { modulusLength: 2048, extractable: true });
  const pem = await exportPKCS8(privateKey);
  return SigningKeyLayer({
    signingKeyPem: Redacted.make(pem),
    issuer: ISS,
    accessTokenTtlSeconds: 3600,
    refreshTokenTtlSeconds: 60 * 60 * 24 * 30,
    authorizationCodeTtlSeconds: 60,
    googleStateTtlSeconds: 600,
  });
};

const deps = {
  issuer: ISS,
  accessTokenTtlSeconds: 3600,
  refreshTokenTtlSeconds: 60 * 60 * 24 * 30,
};

const mkPkce = () => {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
};

describe("handleToken", () => {
  it("exchanges a valid auth code for access+refresh tokens", async () => {
    const layer = await mkLayer();
    const { verifier, challenge } = mkPkce();
    const out = await Effect.runPromise(
      Effect.gen(function* () {
        const code = yield* encodeAuthorizationCode({
          payload: {
            email: "user@example.com",
            client_id: "client-1",
            redirect_uri: "https://claude.ai/api/mcp/auth_callback",
            code_challenge: challenge,
            code_challenge_method: "S256",
          },
          ttlSeconds: 60,
        });
        return yield* handleToken(
          {
            grant_type: "authorization_code",
            code,
            code_verifier: verifier,
            redirect_uri: "https://claude.ai/api/mcp/auth_callback",
            client_id: "client-1",
          },
          deps,
        );
      }).pipe(Effect.provide(layer)),
    );
    expect(out.kind).toBe("json");
    if (out.kind === "json") {
      const body = out.body as Record<string, unknown>;
      expect(typeof body.access_token).toBe("string");
      expect(typeof body.refresh_token).toBe("string");
      expect(body.token_type).toBe("Bearer");
      expect(body.expires_in).toBe(3600);
    }
  });

  it("rejects a code with the wrong PKCE verifier", async () => {
    const layer = await mkLayer();
    const { challenge } = mkPkce();
    const exit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const code = yield* encodeAuthorizationCode({
          payload: {
            email: "user@example.com",
            client_id: "client-1",
            redirect_uri: "https://claude.ai/api/mcp/auth_callback",
            code_challenge: challenge,
            code_challenge_method: "S256",
          },
          ttlSeconds: 60,
        });
        return yield* handleToken(
          {
            grant_type: "authorization_code",
            code,
            code_verifier: "x".repeat(50),
            redirect_uri: "https://claude.ai/api/mcp/auth_callback",
          },
          deps,
        );
      }).pipe(Effect.provide(layer)),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit))
      expect(JSON.stringify(exit.cause)).toContain("PKCE verification failed");
  });

  it("exchanges a valid refresh token for a fresh access+refresh pair", async () => {
    const layer = await mkLayer();
    const out = await Effect.runPromise(
      Effect.gen(function* () {
        const rt = yield* encodeRefreshToken({
          email: "user@example.com",
          issuer: ISS,
          audience: ISS,
          ttlSeconds: 60,
        });
        return yield* handleToken({ grant_type: "refresh_token", refresh_token: rt }, deps);
      }).pipe(Effect.provide(layer)),
    );
    expect(out.kind).toBe("json");
  });

  it("rejects an unsupported grant_type", async () => {
    const layer = await mkLayer();
    const exit = await Effect.runPromiseExit(
      handleToken({ grant_type: "password" }, deps).pipe(Effect.provide(layer)),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit))
      expect(JSON.stringify(exit.cause)).toContain("unsupported grant_type");
  });

  it("rejects auth_code grant when code is missing", async () => {
    const layer = await mkLayer();
    const exit = await Effect.runPromiseExit(
      handleToken({ grant_type: "authorization_code", code_verifier: "x".repeat(50) }, deps).pipe(
        Effect.provide(layer),
      ),
    );
    expect(Exit.isFailure(exit)).toBe(true);
  });
});
