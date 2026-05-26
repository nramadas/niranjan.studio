import { AuthError } from "@niranjan/vault-shared/lib/errors";
import { Effect, Layer } from "effect";
import { SigningKey } from "../../oauth/SigningKey";
import { decodeAccessToken } from "../../oauth/decodeAccessToken";
import { AuthProvider } from "../AuthProvider";
import type { AuthProviderImpl, AuthRequest, Identity } from "../types.ts";

interface OAuthAuthProviderConfig {
  readonly issuer: string;
  /** Audience the access token must carry. In our deployment, same as issuer. */
  readonly audience: string;
}

const extractBearer = (req: AuthRequest): string | undefined => {
  const header = req.header("authorization");
  if (!header) return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1];
};

const buildImpl = (
  cfg: OAuthAuthProviderConfig,
): Effect.Effect<AuthProviderImpl, never, SigningKey> =>
  Effect.gen(function* () {
    const sk = yield* SigningKey;
    const impl: AuthProviderImpl = {
      name: "oauth",
      validateRequest: (req: AuthRequest): Effect.Effect<Identity, AuthError> =>
        Effect.gen(function* () {
          const token = extractBearer(req);
          if (!token) {
            return yield* Effect.fail(
              new AuthError({
                reason: "missing or malformed Authorization: Bearer header",
                statusCode: 401,
              }),
            );
          }
          // Run the OAuth-token decode under the SigningKey we captured
          // at layer-build time. We translate the OAuthError to AuthError
          // because that's the abstraction downstream code expects.
          const result = yield* decodeAccessToken(token, cfg.issuer, cfg.audience).pipe(
            Effect.provideService(SigningKey, sk),
            Effect.mapError(
              (e) =>
                new AuthError({
                  reason: `OAuth token rejected: ${e.description}`,
                  statusCode: e.statusCode === 401 || e.statusCode === 403 ? e.statusCode : 401,
                }),
            ),
          );
          return {
            email: result.sub,
            source: "oauth",
            extra: { iss: result.iss, aud: result.aud },
          };
        }),
    };
    return impl;
  });

/**
 * Build the AuthProvider Layer that gates /mcp using OAuth bearer tokens
 * we issued ourselves (signed by SigningKey, validated by `decodeAccessToken`).
 * This is the only auth provider in the production runtime — the
 * Cloudflare Access + bearer-token approach was retired when we moved to
 * native OAuth on web/iOS/iPad. See docs/obsidian-mcp/auth.md.
 *
 * @param cfg The expected issuer and audience, both equal to OAUTH_ISSUER.
 * @returns   A Layer providing the AuthProvider tag. Depends on SigningKey.
 */
export const OAuthAuthProviderLayer = (cfg: OAuthAuthProviderConfig) =>
  Layer.effect(AuthProvider, buildImpl(cfg));
