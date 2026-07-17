import { type JWTVerifyGetKey, createRemoteJWKSet, jwtVerify } from "jose";
import { GOOGLE_ISSUER, GOOGLE_JWKS_URI } from "../../oauth/googleOidc/constants.ts";

// Shared JWKS cache for the Pub/Sub push tokens (same Google federated
// signing keys that back OIDC id_tokens; see oauth/googleOidc/verifyIdToken
// for the caching rationale).
const googleJwks = createRemoteJWKSet(new URL(GOOGLE_JWKS_URI), {
  cooldownDuration: 60_000,
  cacheMaxAge: 15 * 60_000,
});

export interface MeetPushTokenExpectations {
  /** The `aud` the push subscription was configured with (our webhook URL). */
  readonly audience: string;
  /** The service-account email the push subscription signs tokens as. */
  readonly serviceAccount: string;
  /** Test seam: overrides the remote Google JWKS with a local key set. */
  readonly getKey?: JWTVerifyGetKey;
}

/**
 * Verify the OIDC bearer token Pub/Sub attaches to push deliveries at
 * /meet/webhook. Confirms the signature against Google's JWKS, the issuer
 * is Google, the audience matches the configured push audience, and the
 * token was minted for our push service account (with a verified email).
 * This is the only thing standing between the open internet and transcript
 * ingestion, so failures are deliberately just `false` — the route logs and
 * 401s without leaking why.
 *
 * @param authorizationHeader The raw `Authorization` header (`Bearer <jwt>`).
 * @param expectations        Audience + service-account email to enforce.
 * @returns                   True only when every check passes.
 */
export const verifyMeetPushToken = async (
  authorizationHeader: string | undefined,
  expectations: MeetPushTokenExpectations,
): Promise<boolean> => {
  if (!authorizationHeader?.startsWith("Bearer ")) return false;
  const token = authorizationHeader.slice("Bearer ".length).trim();
  if (!token) return false;

  try {
    const { payload } = await jwtVerify(token, expectations.getKey ?? googleJwks, {
      issuer: GOOGLE_ISSUER,
      audience: expectations.audience,
      algorithms: ["RS256"],
    });
    const email = (payload as { email?: unknown }).email;
    const verified = (payload as { email_verified?: unknown }).email_verified;
    return (
      typeof email === "string" &&
      email.toLowerCase() === expectations.serviceAccount.toLowerCase() &&
      verified === true
    );
  } catch {
    return false;
  }
};
