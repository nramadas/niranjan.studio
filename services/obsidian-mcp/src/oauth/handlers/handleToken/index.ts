import { OAuthError } from "@niranjan/vault-shared/lib/errors";
import { Effect } from "effect";
import { SigningKey } from "../../SigningKey";
import { decodeAuthorizationCode } from "../../decodeAuthorizationCode";
import { decodeRefreshToken } from "../../decodeRefreshToken";
import { encodeAccessToken } from "../../encodeAccessToken";
import { encodeRefreshToken } from "../../encodeRefreshToken";
import type { HandlerResponse, TokenResponse } from "../../types.ts";
import { verifyPkce } from "../../verifyPkce";

interface TokenRequest {
  readonly grant_type?: string | undefined;
  readonly code?: string | undefined;
  readonly code_verifier?: string | undefined;
  readonly redirect_uri?: string | undefined;
  readonly client_id?: string | undefined;
  readonly refresh_token?: string | undefined;
}

interface TokenDeps {
  readonly issuer: string;
  readonly accessTokenTtlSeconds: number;
  readonly refreshTokenTtlSeconds: number;
}

const issueTokens = (
  email: string,
  deps: TokenDeps,
): Effect.Effect<TokenResponse, OAuthError, SigningKey> =>
  Effect.gen(function* () {
    const access_token = yield* encodeAccessToken({
      email,
      issuer: deps.issuer,
      audience: deps.issuer,
      ttlSeconds: deps.accessTokenTtlSeconds,
    });
    const refresh_token = yield* encodeRefreshToken({
      email,
      issuer: deps.issuer,
      audience: deps.issuer,
      ttlSeconds: deps.refreshTokenTtlSeconds,
    });
    return {
      access_token,
      token_type: "Bearer",
      expires_in: deps.accessTokenTtlSeconds,
      refresh_token,
    } as const;
  });

/**
 * POST /token — exchanges either an authorization code (with PKCE) or
 * a refresh token for a new access + refresh token pair. RFC 6749 §4.1.3
 * (auth-code grant) and §6 (refresh-token grant). Any failure is mapped
 * to a tagged OAuthError; main.ts renders the standard
 * `{ error, error_description }` body the spec requires.
 *
 * @param body Parsed application/x-www-form-urlencoded body from the POST.
 * @param deps Issuer URL + token TTLs.
 * @returns    A JSON HandlerResponse with the token response, or an
 *             OAuthError on any validation problem.
 */
export const handleToken = (
  body: TokenRequest,
  deps: TokenDeps,
): Effect.Effect<HandlerResponse, OAuthError, SigningKey> =>
  Effect.gen(function* () {
    if (body.grant_type === "authorization_code") {
      if (!body.code) {
        return yield* Effect.fail(
          new OAuthError({
            code: "invalid_request",
            description: "missing code",
            statusCode: 400,
          }),
        );
      }
      if (!body.code_verifier) {
        return yield* Effect.fail(
          new OAuthError({
            code: "invalid_request",
            description: "missing code_verifier (PKCE is required)",
            statusCode: 400,
          }),
        );
      }
      const code = yield* decodeAuthorizationCode(body.code);
      yield* verifyPkce(body.code_verifier, code.code_challenge, code.code_challenge_method);
      if (body.redirect_uri && body.redirect_uri !== code.redirect_uri) {
        return yield* Effect.fail(
          new OAuthError({
            code: "invalid_grant",
            description: "redirect_uri does not match the value used at /authorize",
            statusCode: 400,
          }),
        );
      }
      if (body.client_id && body.client_id !== code.client_id) {
        return yield* Effect.fail(
          new OAuthError({
            code: "invalid_grant",
            description: "client_id does not match the value used at /authorize",
            statusCode: 400,
          }),
        );
      }
      const tokens = yield* issueTokens(code.email, deps);
      return { kind: "json", status: 200, body: tokens } as const;
    }
    if (body.grant_type === "refresh_token") {
      if (!body.refresh_token) {
        return yield* Effect.fail(
          new OAuthError({
            code: "invalid_request",
            description: "missing refresh_token",
            statusCode: 400,
          }),
        );
      }
      const refresh = yield* decodeRefreshToken(body.refresh_token, deps.issuer, deps.issuer);
      const tokens = yield* issueTokens(refresh.sub, deps);
      return { kind: "json", status: 200, body: tokens } as const;
    }
    return yield* Effect.fail(
      new OAuthError({
        code: "unsupported_grant_type",
        description: `unsupported grant_type "${String(body.grant_type)}"`,
        statusCode: 400,
      }),
    );
  });
