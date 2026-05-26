import { Data } from "effect";

/**
 * Surfaced by any OAuth handler when a request fails the protocol's
 * validation rules. The `code` is the OAuth 2.0 error code (RFC 6749
 * §5.2 / RFC 7591 §3.2.2 for DCR-specific codes); `statusCode` is the
 * HTTP status the response should carry. The HTTP layer renders this as
 * a JSON body of the shape `{ error, error_description }` per the spec.
 *
 * @property code        OAuth error code, e.g. `invalid_grant`.
 * @property description Human-readable explanation. Goes into the JSON
 *                       body and the Cloud Run logs.
 * @property statusCode  HTTP status to return (400, 401, 403, or 500).
 */
export class OAuthError extends Data.TaggedError("OAuthError")<{
  readonly code:
    | "invalid_request"
    | "invalid_client"
    | "invalid_grant"
    | "unauthorized_client"
    | "unsupported_grant_type"
    | "invalid_scope"
    | "access_denied"
    | "server_error"
    | "invalid_redirect_uri"
    | "invalid_client_metadata";
  readonly description: string;
  readonly statusCode: 400 | 401 | 403 | 500;
}> {}
