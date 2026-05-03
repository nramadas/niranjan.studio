import { Effect, type Redacted } from "effect";
import { OAuthError } from "../../../lib/errors/OAuthError";
import { decodeGoogleState } from "../../decodeGoogleState";
import { encodeAuthorizationCode } from "../../encodeAuthorizationCode";
import { exchangeAuthCode } from "../../googleOidc/exchangeAuthCode";
import { verifyIdToken } from "../../googleOidc/verifyIdToken";
import { SigningKey } from "../../SigningKey";
import type { HandlerResponse } from "../../types.ts";

interface CallbackQuery {
  readonly code?: string | undefined;
  readonly state?: string | undefined;
  readonly error?: string | undefined;
  readonly error_description?: string | undefined;
}

interface CallbackDeps {
  readonly googleClientId: string;
  readonly googleClientSecret: Redacted.Redacted<string>;
  readonly googleRedirectUri: string;
  readonly authorizationCodeTtlSeconds: number;
  readonly allowedEmails: ReadonlySet<string>;
}

/**
 * GET /oauth/google/callback — Google's redirect target after the user
 * signs in. We:
 *
 *   1. Decode our `google_state` JWT to recover the resumption payload.
 *   2. Exchange Google's `code` for an `id_token`.
 *   3. Verify the `id_token` against Google's JWKS, getting the email.
 *   4. Check the email against the allow-list.
 *   5. Mint our own authorization code JWT carrying the email + PKCE.
 *   6. Redirect back to the MCP client's redirect_uri with `code` + `state`.
 *
 * @param q    Parsed query parameters from Google's callback.
 * @param deps Google config + auth-code TTL + allow-list.
 * @returns    A redirect HandlerResponse back to the MCP client, or an
 *             OAuthError. Errors here generally surface as redirects to
 *             the original redirect_uri with `error` + `error_description`
 *             — the MCP client expects spec-compliant error reporting.
 *             That mapping happens in main.ts; this function fails with
 *             tagged OAuthErrors and main.ts decides how to surface them.
 */
export const handleGoogleCallback = (
  q: CallbackQuery,
  deps: CallbackDeps,
): Effect.Effect<HandlerResponse, OAuthError, SigningKey> =>
  Effect.gen(function* () {
    if (q.error) {
      return yield* Effect.fail(
        new OAuthError({
          code: "access_denied",
          description: `google rejected sign-in: ${q.error}${q.error_description ? `: ${q.error_description}` : ""}`,
          statusCode: 403,
        }),
      );
    }
    if (!q.code) {
      return yield* Effect.fail(
        new OAuthError({
          code: "invalid_request",
          description: "missing code on google callback",
          statusCode: 400,
        }),
      );
    }
    if (!q.state) {
      return yield* Effect.fail(
        new OAuthError({
          code: "invalid_request",
          description: "missing state on google callback",
          statusCode: 400,
        }),
      );
    }
    const state = yield* decodeGoogleState(q.state);
    const tokenRes = yield* exchangeAuthCode({
      clientId: deps.googleClientId,
      clientSecret: deps.googleClientSecret,
      redirectUri: deps.googleRedirectUri,
      code: q.code,
    });
    const email = yield* verifyIdToken(tokenRes.id_token, deps.googleClientId);
    if (!deps.allowedEmails.has(email)) {
      return yield* Effect.fail(
        new OAuthError({
          code: "access_denied",
          description: `email "${email}" is not in the allow-list`,
          statusCode: 403,
        }),
      );
    }
    const code = yield* encodeAuthorizationCode({
      payload: {
        email,
        client_id: state.client_id,
        redirect_uri: state.redirect_uri,
        code_challenge: state.code_challenge,
        code_challenge_method: state.code_challenge_method,
      },
      ttlSeconds: deps.authorizationCodeTtlSeconds,
    });
    const target = new URL(state.redirect_uri);
    target.searchParams.set("code", code);
    target.searchParams.set("state", state.mcp_state);
    return { kind: "redirect", status: 302, location: target.toString() } as const;
  });
