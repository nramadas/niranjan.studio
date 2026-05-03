import { Context, type Effect } from "effect";
import type { JWK, JWTPayload } from "jose";
import type { OAuthError } from "../../lib/errors/OAuthError";

/**
 * Optional sign-time overrides. `expiresInSeconds` overrides the token's
 * `exp`; if omitted the caller must put `exp` in the payload itself.
 */
export interface SignOptions {
  readonly expiresInSeconds?: number;
}

/**
 * The shape of the OAuth signing key. Encapsulates a single RS256 RSA
 * key pair loaded once at boot. Tokens we issue (auth codes, access
 * tokens, refresh tokens, the Google round-trip state) are all signed
 * with the private half; the public half is served from
 * /.well-known/jwks.json so any JWT-capable client can verify them.
 *
 * The `kid` is the RFC 7638 JWK Thumbprint of the public key — stable
 * for the life of the key, derived deterministically from its bytes, so
 * rotating the key implicitly rotates the kid.
 */
export interface SigningKeyImpl {
  /** RFC 7638 JWK Thumbprint of the public key. Stable across restarts. */
  readonly kid: string;
  /** Public JWK ready for /.well-known/jwks.json. Carries `kid`, `alg`, `use`. */
  readonly publicJwk: JWK;
  /** Sign a JWT with our private key. Always RS256; header includes `kid`. */
  readonly sign: (
    payload: JWTPayload,
    opts?: SignOptions,
  ) => Effect.Effect<string, OAuthError>;
  /**
   * Verify a JWT was signed by us. Returns the decoded payload (with
   * standard claims like `exp`, `iat` validated). Fails OAuthError on
   * any verification problem — bad signature, expired, malformed.
   */
  readonly verify: (token: string) => Effect.Effect<JWTPayload, OAuthError>;
}

/**
 * The SigningKey Effect Context tag. Wired in at boot by `SigningKeyLayer`;
 * consumers (token encoders/decoders, the JWKS handler) pull it via
 * `yield* SigningKey`.
 */
export class SigningKey extends Context.Tag("SigningKey")<SigningKey, SigningKeyImpl>() {}
