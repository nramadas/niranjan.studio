import { Config } from "effect";

/**
 * Typed config for the Cloudflare Access AuthProvider. The team domain is
 * the per-account `<team>.cloudflareaccess.com` (no scheme); the AUD is
 * the application AUD tag from the Zero Trust dashboard.
 */
export const cloudflareAccessConfig = Config.all({
  teamDomain: Config.string("CF_ACCESS_TEAM_DOMAIN"),
  aud: Config.string("CF_ACCESS_AUD"),
});
