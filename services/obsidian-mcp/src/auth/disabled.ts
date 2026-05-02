// Local-dev AuthProvider. Skips the JWT check, still requires the bearer
// token (the bearer check is provider-independent — see ../auth/bearer.ts
// and docs/obsidian-mcp/auth.md). Selected when AUTH_PROVIDER=disabled.
//
// NEVER ship this in front of the Cloud Run service. If somehow it gets
// wired in production, the bearer-token check is the only thing standing
// between random internet traffic and the vault. That's not enough.

import { Effect, Layer, Redacted } from "effect";
import { verifyBearerToken } from "./bearer.js";
import { AuthProvider, type AuthProviderImpl } from "./provider.js";

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
