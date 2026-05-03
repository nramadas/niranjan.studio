import { Config } from "effect";

/**
 * Typed config for using Google as the OIDC identity provider during the
 * `/authorize` step. The client_id/secret come from a Web-application
 * OAuth 2.0 client created in GCP Console → APIs & Services → Credentials;
 * the redirect URI must match exactly what's registered there.
 */
export const googleOidcConfig = Config.all({
  clientId: Config.string("GOOGLE_OAUTH_CLIENT_ID"),
  clientSecret: Config.redacted("GOOGLE_OAUTH_CLIENT_SECRET"),
  redirectUri: Config.string("GOOGLE_OAUTH_REDIRECT_URI"),
});
