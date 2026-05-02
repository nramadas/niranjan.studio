import { Effect, Redacted } from "effect";
import { timingSafeEqual } from "node:crypto";
import { AuthError } from "../../lib/errors/AuthError";
import type { AuthRequest } from "../types.ts";

const constantTimeEqual = (a: string, b: string): boolean => {
  if (a.length !== b.length) {
    // Still touch `a` so the timing profile doesn't cleanly leak the
    // length-mismatch path. The early-return technically still leaks
    // length, but bearer tokens are fixed-length so this only fires for
    // malformed input.
    return timingSafeEqual(Buffer.from(a), Buffer.from(a)) && false;
  }
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
};

/**
 * Defence-in-depth bearer-token verification. Runs alongside whichever
 * AuthProvider is configured — it is not a replacement. The expected
 * value is sourced from Secret Manager via `MCP_BEARER_TOKEN`.
 *
 * @param req      The HTTP request abstraction. Only headers are read.
 * @param expected The expected bearer token, redacted.
 * @returns        An Effect that succeeds with void when the
 *                 `Authorization: Bearer …` header matches `expected`,
 *                 and fails with AuthError(401) when missing or
 *                 AuthError(403) when present but mismatched.
 */
export const verifyBearerToken = (
  req: AuthRequest,
  expected: Redacted.Redacted<string>,
): Effect.Effect<void, AuthError> =>
  Effect.sync(() => {
    const header = req.header("authorization");
    if (!header) {
      return new AuthError({
        reason: "missing Authorization header",
        statusCode: 401,
      });
    }
    const match = /^Bearer\s+(.+)$/i.exec(header.trim());
    if (!match) {
      return new AuthError({
        reason: "Authorization header is not a Bearer token",
        statusCode: 401,
      });
    }
    const presented = match[1] ?? "";
    if (!constantTimeEqual(presented, Redacted.value(expected))) {
      return new AuthError({
        reason: "bearer token did not match",
        statusCode: 403,
      });
    }
    return null;
  }).pipe(Effect.flatMap((err) => (err ? Effect.fail(err) : Effect.void)));
