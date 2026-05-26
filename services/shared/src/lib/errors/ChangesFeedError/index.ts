import { Data } from "effect";

/**
 * Surfaced when the long-poll connection to CouchDB's `_changes` endpoint
 * fails. The fiber that subscribes to the feed retries with exponential
 * backoff on this error; it surfaces here when the retry budget is
 * exhausted.
 *
 * @property message Human-readable detail.
 * @property cause   The original thrown value, kept for debugging.
 */
export class ChangesFeedError extends Data.TaggedError("ChangesFeedError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}
