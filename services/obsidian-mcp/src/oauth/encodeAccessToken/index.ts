import type { OAuthError } from "@niranjan/vault-shared/lib/errors";
import { Effect } from "effect";
import { SigningKey } from "../SigningKey";

/**
 * Sign an access token. Carries the user's email as `sub`, the configured
 * issuer as `iss`, and the resource (typically the same as the issuer)
 * as `aud`. The OAuthAuthProvider validates these on every /mcp request.
 *
 * @param params.email      The authenticated user's email.
 * @param params.issuer     The OAUTH_ISSUER URL — what we're advertising
 *                          ourselves as in the metadata document.
 * @param params.audience   The protected resource the token grants access
 *                          to. Same as the issuer in our deployment.
 * @param params.ttlSeconds Lifetime in seconds.
 * @returns                 An Effect yielding the signed JWT string.
 */
export const encodeAccessToken = (params: {
  readonly email: string;
  readonly issuer: string;
  readonly audience: string;
  readonly ttlSeconds: number;
}): Effect.Effect<string, OAuthError, SigningKey> =>
  Effect.gen(function* () {
    const sk = yield* SigningKey;
    return yield* sk.sign(
      {
        type: "access_token",
        sub: params.email,
        iss: params.issuer,
        aud: params.audience,
      },
      { expiresInSeconds: params.ttlSeconds },
    );
  });
