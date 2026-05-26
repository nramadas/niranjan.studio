import type { OAuthError } from "@niranjan/vault-shared/lib/errors";
import { Effect } from "effect";
import { SigningKey } from "../SigningKey";
import type { AuthorizationCodePayload } from "../types.ts";

/**
 * Sign an authorization code as a JWT. The code is short-lived (the
 * caller passes a TTL — typically 60 seconds, per RFC 6749 guidance)
 * and embeds the PKCE challenge so /token can validate the verifier
 * later without any server-side storage.
 *
 * @param params.payload    Identity + PKCE state to bind to this code.
 * @param params.ttlSeconds Lifetime of the code in seconds.
 * @returns                 An Effect yielding the signed JWT string.
 */
export const encodeAuthorizationCode = (params: {
  readonly payload: Omit<AuthorizationCodePayload, "type">;
  readonly ttlSeconds: number;
}): Effect.Effect<string, OAuthError, SigningKey> =>
  Effect.gen(function* () {
    const sk = yield* SigningKey;
    return yield* sk.sign(
      {
        type: "authorization_code",
        email: params.payload.email,
        client_id: params.payload.client_id,
        redirect_uri: params.payload.redirect_uri,
        code_challenge: params.payload.code_challenge,
        code_challenge_method: params.payload.code_challenge_method,
      },
      { expiresInSeconds: params.ttlSeconds },
    );
  });
