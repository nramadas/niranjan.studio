// Cross-cutting types used by multiple oauth/ exports. Per the styleguide,
// types reused across more than one function-folder belong at the module
// level, not inside any one folder.
//
// Every token we mint carries a `type` discriminator in its claims. This
// is belt-and-braces against an attacker swapping a refresh token into
// a place that expects an access token (or similar). The discriminator
// is checked by every decoder and is independent of the JWT signature.

/**
 * Authorization code we issue at the end of the /authorize → /oauth/google/callback
 * round-trip. The client redeems it at /token in exchange for tokens.
 * Carries the PKCE challenge so /token can verify the code_verifier.
 */
export interface AuthorizationCodePayload {
  readonly type: "authorization_code";
  readonly email: string;
  readonly client_id: string;
  readonly redirect_uri: string;
  readonly code_challenge: string;
  readonly code_challenge_method: string;
}

/**
 * Access token Claude attaches to /mcp requests as `Authorization: Bearer …`.
 * The OAuthAuthProvider validates this on every request.
 */
export interface AccessTokenPayload {
  readonly type: "access_token";
  readonly sub: string;
  readonly iss: string;
  readonly aud: string;
}

/** Refresh token; Claude redeems at /token to get a fresh access token. */
export interface RefreshTokenPayload {
  readonly type: "refresh_token";
  readonly sub: string;
  readonly iss: string;
  readonly aud: string;
}

/**
 * Opaque state we round-trip through Google during the OIDC redirect.
 * Carries everything we need to resume the MCP /authorize flow when
 * Google calls us back at /oauth/google/callback.
 */
export interface GoogleStatePayload {
  readonly type: "google_state";
  readonly client_id: string;
  readonly redirect_uri: string;
  readonly code_challenge: string;
  readonly code_challenge_method: string;
  /** The `state` value the MCP client sent us at /authorize, echoed back to them. */
  readonly mcp_state: string;
}

/**
 * The shape exposed by /oauth/protected-resource and /oauth/authorization-server
 * metadata documents. See RFC 9728 and RFC 8414.
 */
export interface AuthorizationServerMetadata {
  readonly issuer: string;
  readonly authorization_endpoint: string;
  readonly token_endpoint: string;
  readonly registration_endpoint: string;
  readonly jwks_uri: string;
  readonly response_types_supported: ReadonlyArray<string>;
  readonly grant_types_supported: ReadonlyArray<string>;
  readonly code_challenge_methods_supported: ReadonlyArray<string>;
  readonly token_endpoint_auth_methods_supported: ReadonlyArray<string>;
  readonly scopes_supported: ReadonlyArray<string>;
}

export interface ProtectedResourceMetadata {
  readonly resource: string;
  readonly authorization_servers: ReadonlyArray<string>;
}

/**
 * Token-endpoint response shape per RFC 6749 §5.1. We always issue both
 * access and refresh tokens; `expires_in` is the access token's TTL in
 * seconds.
 */
export interface TokenResponse {
  readonly access_token: string;
  readonly token_type: "Bearer";
  readonly expires_in: number;
  readonly refresh_token: string;
}

/** RFC 7591 §3.2.1 — the subset we care about from the response of /register. */
export interface ClientRegistrationResponse {
  readonly client_id: string;
  readonly client_id_issued_at: number;
  readonly token_endpoint_auth_method: "none";
  readonly grant_types: ReadonlyArray<string>;
  readonly response_types: ReadonlyArray<string>;
  readonly redirect_uris: ReadonlyArray<string>;
  readonly client_name?: string;
}

/**
 * Discriminated response shape every OAuth HTTP handler returns. main.ts
 * adapts this to a Node ServerResponse — `json` writes a JSON body with
 * the given status, `redirect` writes a Location header and a 302/303.
 */
export type HandlerResponse =
  | {
      readonly kind: "json";
      readonly status: number;
      readonly body: unknown;
      readonly headers?: Readonly<Record<string, string>>;
    }
  | { readonly kind: "redirect"; readonly status: 302 | 303; readonly location: string };
