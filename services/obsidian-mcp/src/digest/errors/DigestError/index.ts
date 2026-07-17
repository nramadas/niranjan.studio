import { Data } from "effect";

/**
 * Failure from a transcript-digest LLM call. One tagged shape across the
 * extract and merge calls so the webhook handler can degrade uniformly —
 * digestion is best-effort enrichment and must never fail an ingestion
 * that already wrote the transcript note.
 *
 * @property op      Which call failed ("digest_transcript", "merge_todos").
 * @property status  HTTP status when the Claude API returned a non-2xx.
 * @property message Human-readable description.
 * @property cause   Original thrown value, kept for debugging.
 */
export class DigestError extends Data.TaggedError("DigestError")<{
  readonly op: string;
  readonly status?: number;
  readonly message: string;
  readonly cause?: unknown;
}> {}
