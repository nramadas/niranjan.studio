import { Effect } from "effect";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { OAuthError } from "../../../lib/errors/OAuthError";
import { GOOGLE_ISSUER, GOOGLE_JWKS_URI } from "../constants.ts";

// jose's createRemoteJWKSet caches the JWKS for the configured TTL and
// re-fetches on `kid` mismatch. Created once at module load so every
// verify call shares the cache.
const jwks = createRemoteJWKSet(new URL(GOOGLE_JWKS_URI), {
  cooldownDuration: 60_000,
  cacheMaxAge: 15 * 60_000,
});

/**
 * Verify a Google-issued OIDC ID token. Confirms the signature against
 * Google's JWKS, the issuer matches Google, and the audience matches
 * our configured Google client_id. Returns the verified email — the
 * caller is responsible for checking it against the allow-list.
 *
 * @param idToken           The raw `id_token` from the token-exchange response.
 * @param expectedAudience  Our Google OAuth client_id.
 * @returns                 An Effect yielding the verified email. Fails
 *                          OAuthError(`access_denied`, 403) on a
 *                          verification problem or missing email claim
 *                          (a Google account without a verified email
 *                          can't authenticate).
 */
export const verifyIdToken = (
  idToken: string,
  expectedAudience: string,
): Effect.Effect<string, OAuthError> =>
  Effect.tryPromise({
    try: async () => {
      const { payload } = await jwtVerify(idToken, jwks, {
        issuer: GOOGLE_ISSUER,
        audience: expectedAudience,
        algorithms: ["RS256"],
      });
      const email = (payload as { email?: unknown }).email;
      const verified = (payload as { email_verified?: unknown }).email_verified;
      if (typeof email !== "string" || verified !== true) {
        throw new Error("google id_token has no verified email claim");
      }
      return email.toLowerCase();
    },
    catch: (cause) =>
      new OAuthError({
        code: "access_denied",
        description: `google id_token verification failed: ${cause instanceof Error ? cause.message : String(cause)}`,
        statusCode: 403,
      }),
  });
