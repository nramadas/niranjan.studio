import { OAuthError } from "@niranjan/vault-shared/lib/errors";
import { Effect } from "effect";
import { deterministicClientId } from "../../deterministicClientId";
import type { ClientRegistrationResponse, HandlerResponse } from "../../types.ts";

interface RegisterRequest {
  readonly client_name?: unknown;
  readonly redirect_uris?: unknown;
  readonly grant_types?: unknown;
  readonly response_types?: unknown;
  readonly token_endpoint_auth_method?: unknown;
}

/**
 * POST /register — RFC 7591 Dynamic Client Registration. We accept the
 * minimum metadata Claude sends, derive a stable client_id from a hash
 * of it (so re-registering is idempotent and we don't need storage),
 * and return the standard response document. We require:
 *
 * - At least one redirect_uri (HTTPS only, except localhost for dev)
 * - token_endpoint_auth_method = "none" (public client; PKCE is the gate)
 *
 * @param body Parsed JSON body from the POST. Validated here.
 * @returns    A JSON HandlerResponse with the registration document, or
 *             an OAuthError if the metadata is malformed.
 */
export const handleRegister = (body: RegisterRequest): Effect.Effect<HandlerResponse, OAuthError> =>
  Effect.gen(function* () {
    const redirectUris = body.redirect_uris;
    if (!Array.isArray(redirectUris) || redirectUris.length === 0) {
      return yield* Effect.fail(
        new OAuthError({
          code: "invalid_redirect_uri",
          description: "redirect_uris must be a non-empty array",
          statusCode: 400,
        }),
      );
    }
    const uris: string[] = [];
    for (const u of redirectUris) {
      if (typeof u !== "string") {
        return yield* Effect.fail(
          new OAuthError({
            code: "invalid_redirect_uri",
            description: "every redirect_uri must be a string",
            statusCode: 400,
          }),
        );
      }
      let parsed: URL;
      try {
        parsed = new URL(u);
      } catch {
        return yield* Effect.fail(
          new OAuthError({
            code: "invalid_redirect_uri",
            description: `redirect_uri "${u}" is not a valid URL`,
            statusCode: 400,
          }),
        );
      }
      const isLocalhost = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
      if (parsed.protocol !== "https:" && !isLocalhost) {
        return yield* Effect.fail(
          new OAuthError({
            code: "invalid_redirect_uri",
            description: "redirect_uri must use https (localhost http allowed for dev)",
            statusCode: 400,
          }),
        );
      }
      uris.push(u);
    }

    const tokenAuthMethod = body.token_endpoint_auth_method;
    if (tokenAuthMethod !== undefined && tokenAuthMethod !== "none") {
      return yield* Effect.fail(
        new OAuthError({
          code: "invalid_client_metadata",
          description: 'only token_endpoint_auth_method="none" (public clients) is supported',
          statusCode: 400,
        }),
      );
    }

    const clientName = typeof body.client_name === "string" ? body.client_name : undefined;
    const grantTypes = ["authorization_code", "refresh_token"] as const;
    const responseTypes = ["code"] as const;

    const clientId = deterministicClientId({
      ...(clientName !== undefined ? { client_name: clientName } : {}),
      redirect_uris: uris,
      grant_types: grantTypes,
      token_endpoint_auth_method: "none",
    });

    const response: ClientRegistrationResponse = {
      client_id: clientId,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      token_endpoint_auth_method: "none",
      grant_types: grantTypes,
      response_types: responseTypes,
      redirect_uris: uris,
      ...(clientName !== undefined ? { client_name: clientName } : {}),
    };
    return { kind: "json", status: 201, body: response } as const;
  });
