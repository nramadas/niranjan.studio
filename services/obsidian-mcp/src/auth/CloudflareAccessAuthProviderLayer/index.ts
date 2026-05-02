import { Effect, Layer, Redacted } from "effect";
import { createRemoteJWKSet, jwtVerify, type JWTPayload, type JWTVerifyResult } from "jose";
import { AuthError } from "../../lib/errors/AuthError";
import { AuthProvider } from "../AuthProvider";
import { verifyBearerToken } from "../verifyBearerToken";
import type { AuthProviderImpl, AuthRequest, Identity } from "../types.ts";

interface CfClaims extends JWTPayload {
  email?: string;
  identity_nonce?: string;
  country?: string;
  // Service-token requests carry a `common_name` claim instead of `email`.
  common_name?: string;
}

export interface CloudflareAccessConfig {
  readonly teamDomain: string;
  readonly aud: string;
  readonly bearerToken: Redacted.Redacted<string>;
}

const HEADER_JWT = "cf-access-jwt-assertion";
const issuer = (teamDomain: string) => `https://${teamDomain}`;
const certsUrl = (teamDomain: string) =>
  new URL(`https://${teamDomain}/cdn-cgi/access/certs`);

const validateJwt =
  (jwks: ReturnType<typeof createRemoteJWKSet>, teamDomain: string, aud: string) =>
  (token: string): Effect.Effect<JWTVerifyResult<CfClaims>, AuthError> =>
    Effect.tryPromise({
      try: () =>
        jwtVerify<CfClaims>(token, jwks, {
          issuer: issuer(teamDomain),
          audience: aud,
          algorithms: ["RS256"],
        }),
      catch: (err) =>
        new AuthError({
          reason: `Cf-Access-Jwt-Assertion verification failed: ${err instanceof Error ? err.message : String(err)}`,
          statusCode: 403,
        }),
    });

const identityFrom = (payload: CfClaims, source: string): Effect.Effect<Identity, AuthError> => {
  const email =
    payload.email ?? (payload.common_name ? `service-token:${payload.common_name}` : undefined);
  if (!email) {
    return Effect.fail(
      new AuthError({
        reason: "JWT had no `email` or `common_name` claim — Access policy may be misconfigured",
        statusCode: 403,
      }),
    );
  }
  return Effect.succeed({
    email,
    source,
    extra: {
      country: payload.country,
      iss: payload.iss,
      sub: payload.sub,
    },
  });
};

const buildImpl = (cfg: CloudflareAccessConfig): AuthProviderImpl => {
  // jose's createRemoteJWKSet caches the JWKS for the configured TTL and
  // re-fetches on `kid` mismatch. Exactly the cache behaviour we want —
  // no manual cache layer needed.
  const jwks = createRemoteJWKSet(certsUrl(cfg.teamDomain), {
    cooldownDuration: 60_000,
    cacheMaxAge: 15 * 60_000,
  });
  const verify = validateJwt(jwks, cfg.teamDomain, cfg.aud);

  return {
    name: "cloudflare-access",
    validateRequest: (req: AuthRequest) =>
      Effect.gen(function* () {
        // Bearer first — fast rejection of unsigned junk before we go
        // touching JWKS over the network.
        yield* verifyBearerToken(req, cfg.bearerToken);
        const jwt = req.header(HEADER_JWT);
        if (!jwt) {
          return yield* Effect.fail(
            new AuthError({
              reason:
                "Missing Cf-Access-Jwt-Assertion header. Either the request did not pass through Cloudflare Access, or the Access application is misconfigured.",
              statusCode: 403,
            }),
          );
        }
        const result = yield* verify(jwt);
        return yield* identityFrom(result.payload, "cloudflare-access");
      }),
  };
};

/**
 * Build the AuthProvider Layer that gates requests using Cloudflare Access.
 * Validates the `Cf-Access-Jwt-Assertion` JWT against the team's JWKS and
 * runs the bearer-token check as a second factor. See
 * docs/obsidian-mcp/auth.md for the full trust model and the recipe for
 * migrating to a different provider.
 *
 * @param cfg The team domain, application AUD tag, and bearer token.
 * @returns   A Layer that provides the AuthProvider tag.
 */
export const CloudflareAccessAuthProviderLayer = (cfg: CloudflareAccessConfig) =>
  Layer.succeed(AuthProvider, buildImpl(cfg));
