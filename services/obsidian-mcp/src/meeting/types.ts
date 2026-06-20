// Cross-cutting types for the Phase 4 meeting module.

/** One diarized speaker turn, as returned by the transcription-service. */
export interface TranscriptSegment {
  readonly speaker: number;
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

/** The transcription-service's /transcribe response. */
export interface TranscriptResult {
  readonly segments: ReadonlyArray<TranscriptSegment>;
  readonly language?: string;
  readonly durationSec?: number;
  readonly modelName: string;
}

/** Audio handed to the transcription-service: a remote URL or base64 bytes. */
export interface TranscribeAudioInput {
  readonly url?: string;
  readonly base64?: string;
  readonly mimeType?: string;
}
