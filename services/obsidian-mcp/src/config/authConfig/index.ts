import { Config } from "effect";
import type { AuthProviderKind } from "../types.ts";

/**
 * Typed config for the auth layer. `provider` selects which AuthProvider
 * implementation gets wired into the runtime; `bearerToken` is the
 * defence-in-depth secret that runs alongside whichever provider is in
 * use. Defaulting `provider` to "cloudflare-access" matches production;
 * local dev overrides with AUTH_PROVIDER=disabled.
 */
export const authConfig = Config.all({
  provider: Config.literal(
    "cloudflare-access",
    "disabled",
  )("AUTH_PROVIDER").pipe(Config.withDefault<AuthProviderKind>("cloudflare-access")),
  bearerToken: Config.redacted("MCP_BEARER_TOKEN"),
});
