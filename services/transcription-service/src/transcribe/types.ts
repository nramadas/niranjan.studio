// Cross-cutting types for the transcribe module.

/**
 * A single diarized segment of a transcript: one speaker turn, with
 * timestamps in seconds from the start of the audio.
 */
export interface TranscriptSegment {
  /** Diarization label index assigned by the backend (0, 1, 2, ...). */
  readonly speaker: number;
  /** Start time in seconds from the beginning of the audio. */
  readonly start: number;
  /** End time in seconds from the beginning of the audio. */
  readonly end: number;
  /** The transcribed text for this segment. */
  readonly text: string;
}

/** The result of transcribing one audio artifact. */
export interface TranscriptResult {
  readonly segments: ReadonlyArray<TranscriptSegment>;
  /** Detected/declared language tag (e.g. "en"), when the backend reports it. */
  readonly language?: string;
  /** Total audio duration in seconds, when the backend reports it. */
  readonly durationSec?: number;
  /** Stable identifier of the model that produced the transcript. */
  readonly modelName: string;
}

/**
 * The audio handed to a `Transcriber`. Exactly one of `url` (the bot path —
 * the backend fetches it) or `bytes` (the future phone-app path — uploaded
 * directly) is provided.
 */
export interface AudioInput {
  readonly url?: string;
  readonly bytes?: Uint8Array;
  /** MIME type for `bytes` (e.g. "audio/mp3"); ignored when `url` is set. */
  readonly mimeType?: string;
}

/** Per-call transcription options. */
export interface TranscribeOptions {
  /** Whether to run speaker diarization. Defaults to true. */
  readonly diarize?: boolean;
}
