import { OAuthError } from "@niranjan/vault-shared/lib/errors";
import { Effect } from "effect";
import { SigningKey } from "../SigningKey";
import type { AccessTokenPayload } from "../types.ts";

/**
 * Verify an access token presented at /mcp and pull out the identity.
 * Checks the JWT signature + expiry via SigningKey.verify, then asserts
 * the `type` discriminator + the issuer/audience match what we expect.
 *
 * @param jwt              The token from `Authorization: Bearer …`.
 * @param expectedIssuer   The OAUTH_ISSUER URL.
 * @param expectedAudience Same as issuer in our setup.
 * @returns                An Effect yielding the decoded payload. Fails
 *                         OAuthError on any verification problem.
 */
export const decodeAccessToken = (
  jwt: string,
  expectedIssuer: string,
  expectedAudience: string,
): Effect.Effect<AccessTokenPayload, OAuthError, SigningKey> =>
  Effect.gen(function* () {
    const sk = yield* SigningKey;
    const claims = (yield* sk.verify(jwt)) as Record<string, unknown>;
    if (claims.type !== "access_token") {
      return yield* Effect.fail(
        new OAuthError({
          code: "invalid_grant",
          description: `wrong token type: expected "access_token", got "${String(claims.type)}"`,
          statusCode: 401,
        }),
      );
    }
    if (claims.iss !== expectedIssuer) {
      return yield* Effect.fail(
        new OAuthError({
          code: "invalid_grant",
          description: `unexpected issuer: ${String(claims.iss)}`,
          statusCode: 401,
        }),
      );
    }
    if (claims.aud !== expectedAudience) {
      return yield* Effect.fail(
        new OAuthError({
          code: "invalid_grant",
          description: `unexpected audience: ${String(claims.aud)}`,
          statusCode: 401,
        }),
      );
    }
    if (typeof claims.sub !== "string" || !claims.sub) {
      return yield* Effect.fail(
        new OAuthError({
          code: "invalid_grant",
          description: "access token missing sub claim",
          statusCode: 401,
        }),
      );
    }
    return {
      type: "access_token",
      sub: claims.sub,
      iss: expectedIssuer,
      aud: expectedAudience,
    } as const;
  });
