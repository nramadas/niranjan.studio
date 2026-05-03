import { createHash } from "node:crypto";
import { Effect } from "effect";
import { OAuthError } from "../../lib/errors/OAuthError";

/**
 * Verify a PKCE `code_verifier` against the `code_challenge` recorded at
 * /authorize time. We support only the `S256` method per the MCP
 * authorization spec — `plain` is forbidden because it offers no real
 * protection against code interception. The check is:
 *
 *   base64url-no-pad( SHA256( code_verifier ) ) === code_challenge
 *
 * @param verifier  The `code_verifier` the client sent at /token.
 * @param challenge The `code_challenge` we recorded at /authorize.
 * @param method    Must be `"S256"`. Any other value fails fast.
 * @returns         An Effect that succeeds with void on a match, fails
 *                  OAuthError(`invalid_grant`, 400) otherwise.
 */
export const verifyPkce = (
  verifier: string,
  challenge: string,
  method: string,
): Effect.Effect<void, OAuthError> =>
  Effect.sync(() => {
    if (method !== "S256") {
      return new OAuthError({
        code: "invalid_request",
        description: `unsupported PKCE method "${method}"; only S256 is allowed`,
        statusCode: 400,
      });
    }
    if (!verifier) {
      return new OAuthError({
        code: "invalid_request",
        description: "missing code_verifier",
        statusCode: 400,
      });
    }
    // RFC 7636 §4.1: code_verifier must be 43–128 chars from the unreserved set.
    if (verifier.length < 43 || verifier.length > 128) {
      return new OAuthError({
        code: "invalid_grant",
        description: "code_verifier length out of range (43..128)",
        statusCode: 400,
      });
    }
    const computed = createHash("sha256").update(verifier).digest("base64url");
    if (computed !== challenge) {
      return new OAuthError({
        code: "invalid_grant",
        description: "PKCE verification failed",
        statusCode: 400,
      });
    }
    return null;
  }).pipe(Effect.flatMap((err) => (err ? Effect.fail(err) : Effect.void)));
