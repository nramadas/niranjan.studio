// Google's OIDC endpoints. Hard-coded because they are documented stable
// URLs and treating them as config buys nothing — if Google moves them,
// every Google-OIDC integration in the world needs a code change anyway.

export const GOOGLE_AUTHORIZATION_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
export const GOOGLE_JWKS_URI = "https://www.googleapis.com/oauth2/v3/certs";
export const GOOGLE_ISSUER = "https://accounts.google.com";

// We only need `openid email` — `profile` would also fetch the user's
// display name and avatar, which we don't use.
export const GOOGLE_SCOPES = "openid email";
