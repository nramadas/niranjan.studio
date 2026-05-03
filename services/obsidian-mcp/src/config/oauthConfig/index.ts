import { Config } from "effect";

/**
 * Typed config for the OAuth authorization server we run inside the MCP
 * service. The signing key is a PEM-encoded RSA private key (PKCS#8)
 * sourced from Secret Manager. The issuer URL goes into every JWT we
 * mint. TTLs default to sensible values; override only if you know why.
 */
export const oauthConfig = Config.all({
  signingKeyPem: Config.redacted("OAUTH_SIGNING_KEY"),
  issuer: Config.string("OAUTH_ISSUER"),
  accessTokenTtlSeconds: Config.integer("OAUTH_ACCESS_TOKEN_TTL_S").pipe(
    Config.withDefault(60 * 60),
  ),
  refreshTokenTtlSeconds: Config.integer("OAUTH_REFRESH_TOKEN_TTL_S").pipe(
    Config.withDefault(60 * 60 * 24 * 30),
  ),
  authorizationCodeTtlSeconds: Config.integer("OAUTH_AUTHORIZATION_CODE_TTL_S").pipe(
    Config.withDefault(60),
  ),
  googleStateTtlSeconds: Config.integer("OAUTH_GOOGLE_STATE_TTL_S").pipe(
    Config.withDefault(60 * 10),
  ),
});
