import { OAuthError } from "@niranjan/vault-shared/lib/errors";
import { Effect, type Redacted } from "effect";
import { SigningKey } from "../../SigningKey";
import { encodeGoogleState } from "../../encodeGoogleState";
import { buildAuthUrl } from "../../googleOidc/buildAuthUrl";
import type { HandlerResponse } from "../../types.ts";

interface AuthorizeQuery {
  readonly response_type?: string | undefined;
  readonly client_id?: string | undefined;
  readonly redirect_uri?: string | undefined;
  readonly code_challenge?: string | undefined;
  readonly code_challenge_method?: string | undefined;
  readonly state?: string | undefined;
  readonly scope?: string | undefined;
}

interface AuthorizeDeps {
  readonly googleClientId: string;
  readonly googleClientSecret: Redacted.Redacted<string>;
  readonly googleRedirectUri: string;
  readonly googleStateTtlSeconds: number;
}

/**
 * GET /authorize — entry point for Claude's OAuth flow. We don't
 * authenticate the user ourselves; we redirect to Google's OIDC sign-in
 * with an opaque `state` JWT carrying everything we need to resume when
 * Google calls back at /oauth/google/callback.
 *
 * Validation:
 * - response_type must be "code" (we don't support implicit/hybrid)
 * - PKCE code_challenge + S256 method are mandatory (no "plain")
 * - redirect_uri must be present (we don't enforce a registered list —
 *   PKCE is the security boundary)
 * - state is mandatory (we round-trip it back to the client; without
 *   it CSRF protection on the client side breaks)
 *
 * @param q    Parsed query parameters.
 * @param deps Google config + state TTL, supplied by main.ts.
 * @returns    A redirect HandlerResponse to Google's authorization URL,
 *             or an OAuthError on a malformed request.
 */
export const handleAuthorize = (
  q: AuthorizeQuery,
  deps: AuthorizeDeps,
): Effect.Effect<HandlerResponse, OAuthError, SigningKey> =>
  Effect.gen(function* () {
    if (q.response_type !== "code") {
      return yield* Effect.fail(
        new OAuthError({
          code: "unsupported_grant_type",
          description: 'only response_type="code" is supported',
          statusCode: 400,
        }),
      );
    }
    if (!q.client_id) {
      return yield* Effect.fail(
        new OAuthError({
          code: "invalid_request",
          description: "missing client_id",
          statusCode: 400,
        }),
      );
    }
    if (!q.redirect_uri) {
      return yield* Effect.fail(
        new OAuthError({
          code: "invalid_request",
          description: "missing redirect_uri",
          statusCode: 400,
        }),
      );
    }
    if (!q.code_challenge) {
      return yield* Effect.fail(
        new OAuthError({
          code: "invalid_request",
          description: "missing code_challenge (PKCE is required)",
          statusCode: 400,
        }),
      );
    }
    if (q.code_challenge_method !== "S256") {
      return yield* Effect.fail(
        new OAuthError({
          code: "invalid_request",
          description: 'code_challenge_method must be "S256"',
          statusCode: 400,
        }),
      );
    }
    if (!q.state) {
      return yield* Effect.fail(
        new OAuthError({
          code: "invalid_request",
          description: "missing state",
          statusCode: 400,
        }),
      );
    }
    const state = yield* encodeGoogleState({
      payload: {
        client_id: q.client_id,
        redirect_uri: q.redirect_uri,
        code_challenge: q.code_challenge,
        code_challenge_method: q.code_challenge_method,
        mcp_state: q.state,
      },
      ttlSeconds: deps.googleStateTtlSeconds,
    });
    const url = buildAuthUrl({
      clientId: deps.googleClientId,
      redirectUri: deps.googleRedirectUri,
      state,
    });
    return { kind: "redirect", status: 302, location: url } as const;
  });
