import { Effect } from "effect";
import type { OAuthError } from "../../lib/errors/OAuthError";
import { SigningKey } from "../SigningKey";
import type { GoogleStatePayload } from "../types.ts";

/**
 * Sign the opaque `state` value we pass through Google during the OIDC
 * round-trip. Carries everything we need to resume the MCP /authorize
 * flow when Google calls back. Short TTL — the user is supposed to
 * complete sign-in within minutes.
 *
 * @param params.payload    Resumption data: client_id, redirect_uri,
 *                          PKCE challenge, and the MCP client's own state.
 * @param params.ttlSeconds Lifetime in seconds.
 * @returns                 An Effect yielding the signed JWT string.
 */
export const encodeGoogleState = (params: {
  readonly payload: Omit<GoogleStatePayload, "type">;
  readonly ttlSeconds: number;
}): Effect.Effect<string, OAuthError, SigningKey> =>
  Effect.gen(function* () {
    const sk = yield* SigningKey;
    return yield* sk.sign(
      {
        type: "google_state",
        client_id: params.payload.client_id,
        redirect_uri: params.payload.redirect_uri,
        code_challenge: params.payload.code_challenge,
        code_challenge_method: params.payload.code_challenge_method,
        mcp_state: params.payload.mcp_state,
      },
      { expiresInSeconds: params.ttlSeconds },
    );
  });
