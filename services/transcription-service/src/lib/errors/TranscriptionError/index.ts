import { Data } from "effect";

/**
 * Failure surfaced by the `Transcriber` implementations. Wraps the
 * Deepgram HTTP/parse failures (and, in future, local-model errors) and
 * boot-time config failures into a single tagged shape so the HTTP layer
 * renders one consistent 500 body and `main` can fail loud identically.
 *
 * @property provider Which backend produced it ("deepgram", "config", ...).
 * @property status   HTTP status when the failure came from a remote provider.
 * @property message  Human-readable description.
 * @property cause    The original thrown value, kept for debugging.
 */
export class TranscriptionError extends Data.TaggedError("TranscriptionError")<{
  readonly provider: string;
  readonly status?: number;
  readonly message: string;
  readonly cause?: unknown;
}> {}
