import { Data } from "effect";

/**
 * Failure surfaced by the CouchDB client wrapper. Wraps `nano`'s opaque
 * error shapes into a tagged Effect error so callers can pattern-match on
 * the `_tag` and the HTTP status (when present).
 *
 * @property op      The CouchDB operation that failed (e.g. "getDoc", "bulkPut").
 * @property status  HTTP status code when the failure originated from a
 *                   CouchDB response. Absent for transport-level failures.
 * @property message Human-readable description, taken from the upstream
 *                   error's `message` or `reason` field.
 * @property cause   The original thrown value, kept for debugging.
 */
export class CouchDbError extends Data.TaggedError("CouchDbError")<{
  readonly op: string;
  readonly status?: number;
  readonly message: string;
  readonly cause?: unknown;
}> {}
