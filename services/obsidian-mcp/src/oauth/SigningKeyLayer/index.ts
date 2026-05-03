import { type Config, Effect, Layer, Redacted } from "effect";
import {
  calculateJwkThumbprint,
  exportJWK,
  importJWK,
  importPKCS8,
  jwtVerify,
  SignJWT,
} from "jose";
import { oauthConfig } from "../../config/oauthConfig";
import { OAuthError } from "../../lib/errors/OAuthError";
import { SigningKey, type SigningKeyImpl } from "../SigningKey";

type OAuthCfg = Config.Config.Success<typeof oauthConfig>;

const ALG = "RS256";

const wrapErr = (description: string, cause: unknown): OAuthError =>
  new OAuthError({
    code: "server_error",
    description: `${description}: ${cause instanceof Error ? cause.message : String(cause)}`,
    statusCode: 500,
  });

const buildImpl = (cfg: OAuthCfg): Effect.Effect<SigningKeyImpl, OAuthError> =>
  Effect.tryPromise({
    try: async () => {
      // PKCS#8 PEM is the canonical format; users generate it via the
      // generate-oauth-key.sh script. PKCS#1 (`-----BEGIN RSA PRIVATE KEY-----`)
      // would fail here with a clear error from jose.
      const pem = Redacted.value(cfg.signingKeyPem);
      const privateKey = await importPKCS8(pem, ALG, { extractable: true });

      // exportJWK on a private key returns the full JWK with both halves.
      // Strip private fields to derive the public-only JWK we serve.
      const fullJwk = (await exportJWK(privateKey)) as Record<string, unknown>;
      const publicJwk = { ...fullJwk } as Record<string, unknown>;
      for (const k of ["d", "p", "q", "dp", "dq", "qi"]) delete publicJwk[k];
      publicJwk.alg = ALG;
      publicJwk.use = "sig";
      const kid = await calculateJwkThumbprint(publicJwk as Parameters<typeof calculateJwkThumbprint>[0]);
      publicJwk.kid = kid;

      // jose's jwtVerify requires the *public* key for asymmetric
      // algorithms — passing the private key fails with a CryptoKey
      // type error. Re-import the stripped JWK as a verify key.
      const verifyKey = await importJWK(publicJwk as Parameters<typeof importJWK>[0], ALG);

      const impl: SigningKeyImpl = {
        kid,
        publicJwk: publicJwk as SigningKeyImpl["publicJwk"],
        sign: (payload, opts) =>
          Effect.tryPromise({
            try: async () => {
              const builder = new SignJWT(payload).setProtectedHeader({ alg: ALG, kid });
              if (opts?.expiresInSeconds !== undefined) {
                const now = Math.floor(Date.now() / 1000);
                builder.setIssuedAt(now);
                builder.setExpirationTime(now + opts.expiresInSeconds);
              }
              return await builder.sign(privateKey);
            },
            catch: (cause) => wrapErr("failed to sign JWT", cause),
          }),
        verify: (token) =>
          Effect.tryPromise({
            try: async () => {
              const { payload } = await jwtVerify(token, verifyKey, { algorithms: [ALG] });
              return payload;
            },
            catch: (cause) =>
              new OAuthError({
                code: "invalid_grant",
                description: `JWT verification failed: ${cause instanceof Error ? cause.message : String(cause)}`,
                statusCode: 400,
              }),
          }),
      };
      return impl;
    },
    catch: (cause) => wrapErr("failed to load OAuth signing key", cause),
  });

/**
 * Build the Layer providing the `SigningKey` tag from resolved OAuth
 * config. Loads the PKCS#8 PEM into a CryptoKey once at boot, derives
 * the public JWK + RFC 7638 thumbprint kid, and wires sign/verify
 * operations that all share that single key. Failures during key load
 * fail the whole runtime — without a usable signing key the server
 * cannot issue or validate any token.
 *
 * @param cfg Resolved OAuth config (signing key PEM, issuer, TTLs).
 * @returns   A Layer providing the SigningKey tag.
 */
export const SigningKeyLayer = (cfg: OAuthCfg) => Layer.effect(SigningKey, buildImpl(cfg));
