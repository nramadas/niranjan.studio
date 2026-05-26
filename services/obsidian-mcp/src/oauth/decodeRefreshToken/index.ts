import { OAuthError } from "@niranjan/vault-shared/lib/errors";
import { Effect } from "effect";
import { SigningKey } from "../SigningKey";
import type { RefreshTokenPayload } from "../types.ts";

/**
 * Verify a refresh token presented at /token (`grant_type=refresh_token`).
 * Same checks as the access-token decoder: signature + expiry, type
 * discriminator, issuer, audience, and a present `sub`.
 *
 * @param jwt              The `refresh_token` parameter from /token.
 * @param expectedIssuer   The OAUTH_ISSUER URL.
 * @param expectedAudience Same as issuer in our setup.
 * @returns                An Effect yielding the decoded payload.
 */
export const decodeRefreshToken = (
  jwt: string,
  expectedIssuer: string,
  expectedAudience: string,
): Effect.Effect<RefreshTokenPayload, OAuthError, SigningKey> =>
  Effect.gen(function* () {
    const sk = yield* SigningKey;
    const claims = (yield* sk.verify(jwt)) as Record<string, unknown>;
    if (claims.type !== "refresh_token") {
      return yield* Effect.fail(
        new OAuthError({
          code: "invalid_grant",
          description: `wrong token type: expected "refresh_token", got "${String(claims.type)}"`,
          statusCode: 400,
        }),
      );
    }
    if (claims.iss !== expectedIssuer) {
      return yield* Effect.fail(
        new OAuthError({
          code: "invalid_grant",
          description: `unexpected issuer: ${String(claims.iss)}`,
          statusCode: 400,
        }),
      );
    }
    if (claims.aud !== expectedAudience) {
      return yield* Effect.fail(
        new OAuthError({
          code: "invalid_grant",
          description: `unexpected audience: ${String(claims.aud)}`,
          statusCode: 400,
        }),
      );
    }
    if (typeof claims.sub !== "string" || !claims.sub) {
      return yield* Effect.fail(
        new OAuthError({
          code: "invalid_grant",
          description: "refresh token missing sub claim",
          statusCode: 400,
        }),
      );
    }
    return {
      type: "refresh_token",
      sub: claims.sub,
      iss: expectedIssuer,
      aud: expectedAudience,
    } as const;
  });
