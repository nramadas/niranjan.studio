// Cross-cutting types for the Phase 4/5 meeting module.

import type { Redacted } from "effect";

/**
 * One Google account whose Meet transcripts are ingested (Phase 5).
 * Parsed from the MEET_ACCOUNTS_JSON secret by `parseMeetAccounts`.
 */
export interface MeetAccount {
  /** Short label ("personal", "work") — appears in logs and note frontmatter. */
  readonly name: string;
  /** Refresh token with the meetings.space.readonly scope for this account. */
  readonly refreshToken: Redacted.Redacted<string>;
  /**
   * Workspace Events target for this account's subscription, e.g.
   * `//cloudidentity.googleapis.com/users/{gaia-id}`.
   */
  readonly targetResource: string;
}

/** One diarized speaker turn, as returned by the transcription-service. */
export interface TranscriptSegment {
  readonly speaker: number;
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

/**
 * One active-speaker interval from Recall's speaker timeline. `start`/`end` are
 * seconds from the recording start — the same origin as a TranscriptSegment's
 * times — so the two can be aligned to attribute diarized turns to people.
 */
export interface SpeakerInterval {
  readonly name: string;
  readonly start: number;
  readonly end: number;
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
