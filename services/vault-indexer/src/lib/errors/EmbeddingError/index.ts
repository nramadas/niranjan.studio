import { Data } from "effect";

/**
 * Failure surfaced by the `Embedder` implementations. Wraps both the
 * in-process bge-small ONNX errors and the OpenAI HTTP errors into a
 * single tagged shape so the caller (`reindexNote`, `semanticSearch`) can
 * react identically — log, retry the affected batch, or fail the doc and
 * carry on with the next one.
 *
 * @property model   The embedder's `modelName` (e.g. "bge-small-en-v1.5").
 *                   Lets log aggregation pinpoint which model produced
 *                   the failure during an eval run that uses two.
 * @property status  HTTP status when the failure came from a remote
 *                   provider; absent for in-process model errors.
 * @property message Human-readable description.
 * @property cause   The original thrown value, kept for debugging.
 */
export class EmbeddingError extends Data.TaggedError("EmbeddingError")<{
  readonly model: string;
  readonly status?: number;
  readonly message: string;
  readonly cause?: unknown;
}> {}
