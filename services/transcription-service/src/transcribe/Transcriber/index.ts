import { Context, type Effect } from "effect";
import type { TranscriptionError } from "../../lib/errors/TranscriptionError";
import type { AudioInput, TranscribeOptions, TranscriptResult } from "../types.ts";

/**
 * The shape of a speech-to-text backend. Implementations may call a cloud
 * provider (Deepgram) or, in future, run a model locally on the VM. The
 * interface is identical so the HTTP layer and every caller are
 * backend-agnostic — the same property that lets a future phone-capture
 * app reuse this service unchanged, and that lets the backend be swapped
 * from cloud to local without touching anything upstream.
 */
export interface TranscriberImpl {
  /** Stable model identifier, e.g. "deepgram-nova-3". */
  readonly modelName: string;
  /**
   * Transcribe one audio artifact into diarized segments. Fails with
   * `TranscriptionError` if the backend rejects the audio or a remote
   * provider call fails.
   */
  readonly transcribe: (
    audio: AudioInput,
    opts?: TranscribeOptions,
  ) => Effect.Effect<TranscriptResult, TranscriptionError>;
}

/**
 * The Transcriber Effect Context tag. Wired in at boot by
 * `selectTranscriberLayer`; the HTTP handler pulls it via `Effect.gen`.
 */
export class Transcriber extends Context.Tag("Transcriber")<Transcriber, TranscriberImpl>() {}
