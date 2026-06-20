import { Data } from "effect";

/**
 * Failure from a Recall.ai API call. One tagged shape across create-bot,
 * leave-call, get-recording, and delete-media so the MCP tools and the
 * webhook handler can react and log uniformly.
 *
 * @property op      Which call failed ("create_bot", "leave_call", ...).
 * @property status  HTTP status when Recall returned a non-2xx.
 * @property message Human-readable description.
 * @property cause   Original thrown value, kept for debugging.
 */
export class RecallError extends Data.TaggedError("RecallError")<{
  readonly op: string;
  readonly status?: number;
  readonly message: string;
  readonly cause?: unknown;
}> {}
