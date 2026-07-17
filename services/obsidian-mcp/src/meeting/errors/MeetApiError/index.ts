import { Data } from "effect";

/**
 * Failure from a Google Meet REST API or Workspace Events API call. One
 * tagged shape across token refresh, conference-record/transcript/participant
 * reads, and subscription management so the webhook handler can react and
 * log uniformly.
 *
 * @property op      Which call failed ("refresh_token", "list_entries", ...).
 * @property status  HTTP status when Google returned a non-2xx.
 * @property message Human-readable description.
 * @property cause   Original thrown value, kept for debugging.
 */
export class MeetApiError extends Data.TaggedError("MeetApiError")<{
  readonly op: string;
  readonly status?: number;
  readonly message: string;
  readonly cause?: unknown;
}> {}
