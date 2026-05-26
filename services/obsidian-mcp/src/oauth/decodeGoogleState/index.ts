import { OAuthError } from "@niranjan/vault-shared/lib/errors";
import { Effect } from "effect";
import { SigningKey } from "../SigningKey";
import type { GoogleStatePayload } from "../types.ts";

const requireString = (v: unknown, field: string): Effect.Effect<string, OAuthError> =>
  typeof v === "string" && v.length > 0
    ? Effect.succeed(v)
    : Effect.fail(
        new OAuthError({
          code: "invalid_request",
          description: `google_state missing required claim "${field}"`,
          statusCode: 400,
        }),
      );

/**
 * Verify the `state` value Google echoes back at /oauth/google/callback
 * and pull out the resumption payload. Without a valid state we cannot
 * resume the MCP /authorize flow — drop the request.
 *
 * @param jwt The `state` parameter from the Google callback URL.
 * @returns   An Effect yielding the decoded payload.
 */
export const decodeGoogleState = (
  jwt: string,
): Effect.Effect<GoogleStatePayload, OAuthError, SigningKey> =>
  Effect.gen(function* () {
    const sk = yield* SigningKey;
    const claims = (yield* sk.verify(jwt)) as Record<string, unknown>;
    if (claims.type !== "google_state") {
      return yield* Effect.fail(
        new OAuthError({
          code: "invalid_request",
          description: `wrong token type: expected "google_state", got "${String(claims.type)}"`,
          statusCode: 400,
        }),
      );
    }
    const client_id = yield* requireString(claims.client_id, "client_id");
    const redirect_uri = yield* requireString(claims.redirect_uri, "redirect_uri");
    const code_challenge = yield* requireString(claims.code_challenge, "code_challenge");
    const code_challenge_method = yield* requireString(
      claims.code_challenge_method,
      "code_challenge_method",
    );
    const mcp_state = yield* requireString(claims.mcp_state, "mcp_state");
    return {
      type: "google_state",
      client_id,
      redirect_uri,
      code_challenge,
      code_challenge_method,
      mcp_state,
    } as const;
  });
