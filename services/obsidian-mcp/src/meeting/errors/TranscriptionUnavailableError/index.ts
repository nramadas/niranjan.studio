import { Data } from "effect";

/**
 * Failure reaching or getting a usable response from the
 * transcription-service. Mirrors the shape of the search side's
 * IndexerUnavailableError so the webhook handler can log a clean,
 * attributable reason.
 */
export class TranscriptionUnavailableError extends Data.TaggedError(
  "TranscriptionUnavailableError",
)<{
  readonly reason: "timeout" | "network" | "bad_status" | "bad_body";
  readonly status?: number;
  readonly message: string;
  readonly cause?: unknown;
}> {}
