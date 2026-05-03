import { Effect } from "effect";
import { OAuthError } from "../../lib/errors/OAuthError";
import { SigningKey } from "../SigningKey";
import type { AuthorizationCodePayload } from "../types.ts";

const requireString = (v: unknown, field: string): Effect.Effect<string, OAuthError> =>
  typeof v === "string" && v.length > 0
    ? Effect.succeed(v)
    : Effect.fail(
        new OAuthError({
          code: "invalid_grant",
          description: `authorization code missing required claim "${field}"`,
          statusCode: 400,
        }),
      );

/**
 * Verify a previously-issued authorization code and pull out the
 * payload. Validates the JWT signature + expiry via SigningKey.verify,
 * then asserts the `type` discriminator matches and the required
 * payload fields are present.
 *
 * @param jwt The token presented at /token as the `code` parameter.
 * @returns   An Effect yielding the decoded code payload. Fails
 *            OAuthError(`invalid_grant`, 400) on any verification
 *            problem or shape mismatch.
 */
export const decodeAuthorizationCode = (
  jwt: string,
): Effect.Effect<AuthorizationCodePayload, OAuthError, SigningKey> =>
  Effect.gen(function* () {
    const sk = yield* SigningKey;
    const claims = (yield* sk.verify(jwt)) as Record<string, unknown>;
    if (claims.type !== "authorization_code") {
      return yield* Effect.fail(
        new OAuthError({
          code: "invalid_grant",
          description: `wrong token type: expected "authorization_code", got "${String(claims.type)}"`,
          statusCode: 400,
        }),
      );
    }
    const email = yield* requireString(claims.email, "email");
    const client_id = yield* requireString(claims.client_id, "client_id");
    const redirect_uri = yield* requireString(claims.redirect_uri, "redirect_uri");
    const code_challenge = yield* requireString(claims.code_challenge, "code_challenge");
    const code_challenge_method = yield* requireString(
      claims.code_challenge_method,
      "code_challenge_method",
    );
    return {
      type: "authorization_code",
      email,
      client_id,
      redirect_uri,
      code_challenge,
      code_challenge_method,
    } as const;
  });
