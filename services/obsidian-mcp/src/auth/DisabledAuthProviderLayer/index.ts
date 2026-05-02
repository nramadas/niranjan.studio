import { Effect, Layer, Redacted } from "effect";
import { AuthProvider } from "../AuthProvider";
import { verifyBearerToken } from "../verifyBearerToken";
import type { AuthProviderImpl } from "../types.ts";

/**
 * Local-dev AuthProvider Layer. Skips the JWT check, still requires the
 * bearer token (the bearer check is provider-independent — see
 * docs/obsidian-mcp/auth.md). Selected when AUTH_PROVIDER=disabled.
 *
 * NEVER ship this in front of the Cloud Run service. If somehow it gets
 * wired in production, the bearer-token check is the only thing standing
 * between random internet traffic and the vault.
 *
 * @param bearerToken The bearer token to validate against.
 * @returns           A Layer that provides the AuthProvider tag.
 */
export const DisabledAuthProviderLayer = (bearerToken: Redacted.Redacted<string>) => {
  const impl: AuthProviderImpl = {
    name: "disabled",
    validateRequest: (req) =>
      verifyBearerToken(req, bearerToken).pipe(
        Effect.as({
          email: "local-dev",
          source: "disabled",
        }),
      ),
  };
  return Layer.succeed(AuthProvider, impl);
};
