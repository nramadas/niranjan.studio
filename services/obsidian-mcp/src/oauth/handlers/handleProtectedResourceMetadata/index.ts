import { Effect } from "effect";
import type { HandlerResponse, ProtectedResourceMetadata } from "../../types.ts";

/**
 * GET /.well-known/oauth-protected-resource — RFC 9728 metadata that
 * tells clients which authorization server to use for this resource.
 * In our deployment the resource and authorization server share an
 * origin, so we point right back at ourselves.
 *
 * @param issuer The OAUTH_ISSUER URL — both the resource and the AS.
 * @returns      A JSON HandlerResponse with the metadata document.
 */
export const handleProtectedResourceMetadata = (
  issuer: string,
): Effect.Effect<HandlerResponse, never> =>
  Effect.sync(() => {
    const meta: ProtectedResourceMetadata = {
      resource: issuer,
      authorization_servers: [issuer],
    };
    return {
      kind: "json",
      status: 200,
      body: meta,
      headers: { "Cache-Control": "public, max-age=300" },
    } as const;
  });
