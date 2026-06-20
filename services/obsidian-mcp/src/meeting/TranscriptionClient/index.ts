import { Context, type Effect } from "effect";
import type { TranscriptionUnavailableError } from "../errors/TranscriptionUnavailableError";
import type { TranscribeAudioInput, TranscriptResult } from "../types.ts";

/**
 * HTTP client to the isolated transcription-service. One operation: post
 * an audio artifact, get a diarized transcript. Failures map to the tagged
 * `TranscriptionUnavailableError`.
 */
export interface TranscriptionClientImpl {
  readonly transcribe: (
    audio: TranscribeAudioInput,
    diarize: boolean,
  ) => Effect.Effect<TranscriptResult, TranscriptionUnavailableError>;
}

/** The TranscriptionClient Effect Context tag. Wired in by `TranscriptionClientLayer`. */
export class TranscriptionClient extends Context.Tag("TranscriptionClient")<
  TranscriptionClient,
  TranscriptionClientImpl
>() {}
