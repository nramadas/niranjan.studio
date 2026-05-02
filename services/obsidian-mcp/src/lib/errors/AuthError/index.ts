import { Data } from "effect";

/**
 * Surfaced by an AuthProvider when a request fails to authenticate. The
 * HTTP layer maps the `statusCode` directly to the response status —
 * 401 for missing credentials, 403 for credentials that are present but
 * don't match.
 *
 * @property reason     Human-readable explanation. Goes into the JSON body
 *                      and the Cloud Run logs.
 * @property statusCode HTTP status to return (401 or 403).
 */
export class AuthError extends Data.TaggedError("AuthError")<{
  readonly reason: string;
  readonly statusCode: 401 | 403;
}> {}
