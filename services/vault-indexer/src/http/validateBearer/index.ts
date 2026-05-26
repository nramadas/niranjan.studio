import { timingSafeEqual } from "node:crypto";

/**
 * Constant-time bearer-token comparison. Returns true iff the request's
 * `Authorization: Bearer <X>` value equals the expected token, with no
 * length-leaking short-circuit.
 *
 * Length mismatch is handled up front by padding to the same length —
 * `timingSafeEqual` itself throws on unequal-length buffers, which would
 * leak length via the exception path.
 *
 * @param header   Raw header value the client sent (may be undefined).
 * @param expected The configured secret.
 * @returns        true iff the value matches.
 */
export const validateBearer = (header: string | undefined, expected: string): boolean => {
  if (!header) return false;
  if (!header.toLowerCase().startsWith("bearer ")) return false;
  const provided = header.slice("bearer ".length).trim();
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) {
    // Burn the time we would have spent comparing a real token of `b`'s
    // length, then return false. timingSafeEqual on equal-length buffers
    // is O(n); comparing `b` to itself replicates that work.
    timingSafeEqual(b, b);
    return false;
  }
  return timingSafeEqual(a, b);
};
