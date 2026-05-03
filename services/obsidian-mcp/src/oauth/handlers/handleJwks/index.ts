import { Effect } from "effect";
import { SigningKey } from "../../SigningKey";
import type { HandlerResponse } from "../../types.ts";

/**
 * GET /.well-known/jwks.json — the JSON Web Key Set advertising the
 * public half of our signing key. Anyone validating tokens we issue
 * (Claude, in principle) can pull this URL and verify offline.
 *
 * @returns A JSON HandlerResponse containing `{ keys: [publicJwk] }`.
 */
export const handleJwks = (): Effect.Effect<HandlerResponse, never, SigningKey> =>
  Effect.gen(function* () {
    const sk = yield* SigningKey;
    return {
      kind: "json",
      status: 200,
      body: { keys: [sk.publicJwk] },
      // JWKS is cacheable — the kid changes only when the underlying
      // key rotates. 5 minutes is a reasonable balance between cache
      // hits and rotation responsiveness.
      headers: { "Cache-Control": "public, max-age=300" },
    } as const;
  });
