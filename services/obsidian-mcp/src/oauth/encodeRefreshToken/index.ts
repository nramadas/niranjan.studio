import type { OAuthError } from "@niranjan/vault-shared/lib/errors";
import { Effect } from "effect";
import { SigningKey } from "../SigningKey";

/**
 * Sign a refresh token. Same shape as an access token but with the
 * `refresh_token` type discriminator and a much longer TTL (typically
 * 30 days). The decoder rejects any attempt to present this token as
 * an access token at /mcp.
 *
 * @param params.email      The authenticated user's email.
 * @param params.issuer     OAUTH_ISSUER URL.
 * @param params.audience   Same as issuer in our deployment.
 * @param params.ttlSeconds Lifetime in seconds.
 * @returns                 An Effect yielding the signed JWT string.
 */
export const encodeRefreshToken = (params: {
  readonly email: string;
  readonly issuer: string;
  readonly audience: string;
  readonly ttlSeconds: number;
}): Effect.Effect<string, OAuthError, SigningKey> =>
  Effect.gen(function* () {
    const sk = yield* SigningKey;
    return yield* sk.sign(
      {
        type: "refresh_token",
        sub: params.email,
        iss: params.issuer,
        aud: params.audience,
      },
      { expiresInSeconds: params.ttlSeconds },
    );
  });
