import { GOOGLE_AUTHORIZATION_ENDPOINT, GOOGLE_SCOPES } from "../constants.ts";

/**
 * Build the URL we redirect the user's browser to for Google OIDC sign-in.
 * Carries our own opaque `state` (a signed JWT — see `encodeGoogleState`)
 * which Google echoes back in the callback so we can resume the original
 * MCP /authorize flow.
 *
 * @param params.clientId    Google OAuth 2.0 client_id (Web application).
 * @param params.redirectUri Must exactly match an authorized redirect URI
 *                           in the Google client config.
 * @param params.state       Opaque state we round-trip through Google.
 * @param params.loginHint   Optional `login_hint` to pre-fill the user's
 *                           email in Google's account chooser.
 * @returns                  A fully-formed Google authorization URL.
 */
export const buildAuthUrl = (params: {
  readonly clientId: string;
  readonly redirectUri: string;
  readonly state: string;
  readonly loginHint?: string;
}): string => {
  const url = new URL(GOOGLE_AUTHORIZATION_ENDPOINT);
  url.searchParams.set("client_id", params.clientId);
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GOOGLE_SCOPES);
  url.searchParams.set("state", params.state);
  url.searchParams.set("access_type", "online");
  url.searchParams.set("prompt", "select_account");
  if (params.loginHint) url.searchParams.set("login_hint", params.loginHint);
  return url.toString();
};
