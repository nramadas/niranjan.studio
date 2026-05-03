import { Effect } from "effect";
import type { AuthorizationServerMetadata, HandlerResponse } from "../../types.ts";

/**
 * GET /.well-known/oauth-authorization-server — RFC 8414 metadata for
 * our authorization server. Claude reads this during connector setup to
 * discover the /authorize, /token, /register, and /jwks endpoints.
 *
 * Everything is derived from the configured issuer URL — the endpoint
 * paths are fixed by our routing, so we just concatenate.
 *
 * @param issuer The OAUTH_ISSUER URL. Same value the tokens carry as `iss`.
 * @returns      A JSON HandlerResponse with the metadata document.
 */
export const handleAuthorizationServerMetadata = (
  issuer: string,
): Effect.Effect<HandlerResponse, never> =>
  Effect.sync(() => {
    const meta: AuthorizationServerMetadata = {
      issuer,
      authorization_endpoint: `${issuer}/authorize`,
      token_endpoint: `${issuer}/token`,
      registration_endpoint: `${issuer}/register`,
      jwks_uri: `${issuer}/.well-known/jwks.json`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      // Public clients only — PKCE is the protection. There is no
      // client_secret to authenticate; no `client_secret_basic` etc.
      token_endpoint_auth_methods_supported: ["none"],
      scopes_supported: ["openid", "email"],
    };
    return {
      kind: "json",
      status: 200,
      body: meta,
      headers: { "Cache-Control": "public, max-age=300" },
    } as const;
  });
