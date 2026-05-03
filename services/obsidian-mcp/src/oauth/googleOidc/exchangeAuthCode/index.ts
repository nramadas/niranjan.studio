import { Effect, Redacted } from "effect";
import { OAuthError } from "../../../lib/errors/OAuthError";
import { GOOGLE_TOKEN_ENDPOINT } from "../constants.ts";

/**
 * The subset of Google's token-endpoint response we actually use. Google
 * also returns `access_token`, `expires_in`, `refresh_token`, etc., but
 * only the `id_token` matters for OIDC sign-in — we never call Google
 * APIs on the user's behalf.
 */
export interface GoogleTokenResponse {
  readonly id_token: string;
}

/**
 * Exchange an authorization code from Google for an ID token. Hits
 * Google's `/token` endpoint with the OAuth 2.0 authorization-code grant.
 * Failures map to OAuthError(`server_error`, 500) — these only happen on
 * misconfiguration or if Google is down, so the user can do nothing
 * about them at the moment they hit the callback.
 *
 * @param params.clientId     Our Google OAuth client_id.
 * @param params.clientSecret Our Google OAuth client_secret (redacted).
 * @param params.redirectUri  Must match the redirect_uri sent at /authorize.
 * @param params.code         The `code` parameter from the callback.
 * @returns                   An Effect that yields the ID token (still
 *                            unverified — pass through `verifyIdToken`).
 */
export const exchangeAuthCode = (params: {
  readonly clientId: string;
  readonly clientSecret: Redacted.Redacted<string>;
  readonly redirectUri: string;
  readonly code: string;
}): Effect.Effect<GoogleTokenResponse, OAuthError> =>
  Effect.tryPromise({
    try: async () => {
      const body = new URLSearchParams({
        client_id: params.clientId,
        client_secret: Redacted.value(params.clientSecret),
        redirect_uri: params.redirectUri,
        code: params.code,
        grant_type: "authorization_code",
      });
      const res = await fetch(GOOGLE_TOKEN_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`google /token returned ${res.status}: ${text}`);
      }
      const json = (await res.json()) as { id_token?: unknown };
      if (typeof json.id_token !== "string") {
        throw new Error("google /token response missing id_token");
      }
      return { id_token: json.id_token };
    },
    catch: (cause) =>
      new OAuthError({
        code: "server_error",
        description: `google code exchange failed: ${cause instanceof Error ? cause.message : String(cause)}`,
        statusCode: 500,
      }),
  });
