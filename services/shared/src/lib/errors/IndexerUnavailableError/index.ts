import { Data } from "effect";

/**
 * Raised when the MCP server's call to the vault-indexer `/search`
 * endpoint fails — network error, timeout, non-2xx response, malformed
 * body, anything. The point of this error being tagged is so the
 * orchestrator (`hybridSearch`) can catch *exactly* this case and fall
 * back to lexical-only without swallowing unrelated failures.
 *
 * Indexer downtime must not break `search_notes`. The error reaches a
 * log line in Cloud Logging and the tool returns whatever BM25 produces.
 *
 * @property reason  Short tag-style reason (`timeout`, `network`,
 *                   `bad_status`, `bad_body`).
 * @property status  HTTP status when reachable but unhappy.
 * @property message Human-readable description.
 * @property cause   The original thrown value, for log forensics.
 */
export class IndexerUnavailableError extends Data.TaggedError("IndexerUnavailableError")<{
  readonly reason: "timeout" | "network" | "bad_status" | "bad_body";
  readonly status?: number;
  readonly message: string;
  readonly cause?: unknown;
}> {}
