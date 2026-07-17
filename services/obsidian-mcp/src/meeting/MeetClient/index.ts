import { Context, type Effect } from "effect";
import type { MeetApiError } from "../errors/MeetApiError";

/** The slice of a Meet conference record the ingestion flow reads. */
export interface ConferenceRecordInfo {
  /** Resource name: `conferenceRecords/{id}`. */
  readonly name: string;
  /** ISO timestamp the conference started. */
  readonly startTime?: string;
  /** ISO timestamp the conference ended. */
  readonly endTime?: string;
  /** Resource name of the meeting space: `spaces/{id}`. */
  readonly space?: string;
}

/** One utterance from Google's own Meet transcription. */
export interface MeetTranscriptEntry {
  /** Speaker resource name: `conferenceRecords/{cr}/participants/{p}`. */
  readonly participant?: string;
  readonly text: string;
  readonly languageCode?: string;
  /** Absolute ISO timestamp the utterance started. */
  readonly startTime?: string;
  /** Absolute ISO timestamp the utterance ended. */
  readonly endTime?: string;
}

/** A conference participant, resolved to a human-readable display name. */
export interface MeetParticipant {
  /** Resource name: `conferenceRecords/{cr}/participants/{p}`. */
  readonly name: string;
  readonly displayName: string;
}

/** What ensureSubscription did to one account's Workspace Events subscription. */
export interface EnsureSubscriptionResult {
  readonly action: "created" | "renewed" | "reactivated";
}

/** The non-secret slice of a configured account, for routing and logging. */
export interface MeetAccountRef {
  readonly name: string;
  readonly targetResource: string;
}

/**
 * Every read happens *as* one of the configured Google accounts — Meet
 * artifact ACLs follow meeting membership, so the caller picks (or probes
 * for) the account that can see a given conference. Methods take the
 * account's `name`; an unknown name fails with MeetApiError (op "account").
 */
export interface MeetClientImpl {
  /** The configured accounts (names + subscription targets, no secrets). */
  readonly accounts: ReadonlyArray<MeetAccountRef>;
  /** Fetch a conference record by resource name (`conferenceRecords/{id}`). */
  readonly getConferenceRecord: (
    account: string,
    name: string,
  ) => Effect.Effect<ConferenceRecordInfo, MeetApiError>;
  /**
   * Fetch every transcript entry for a transcript resource
   * (`conferenceRecords/{cr}/transcripts/{t}`), following pagination.
   */
  readonly listTranscriptEntries: (
    account: string,
    transcriptName: string,
  ) => Effect.Effect<ReadonlyArray<MeetTranscriptEntry>, MeetApiError>;
  /** Fetch every participant of a conference record, following pagination. */
  readonly listParticipants: (
    account: string,
    conferenceRecordName: string,
  ) => Effect.Effect<ReadonlyArray<MeetParticipant>, MeetApiError>;
  /** Best-effort lookup of a space's human meeting code (`abc-defg-hij`). */
  readonly getSpaceMeetingCode: (
    account: string,
    spaceName: string,
  ) => Effect.Effect<string | undefined, MeetApiError>;
  /**
   * Make sure one account's Workspace Events subscription (feeding
   * /meet/webhook) exists and is nowhere near expiry: create it if missing,
   * reactivate it if suspended, renew its TTL otherwise.
   */
  readonly ensureSubscription: (
    account: string,
  ) => Effect.Effect<EnsureSubscriptionResult, MeetApiError>;
}

/**
 * The Google Meet client Effect Context tag. Wired in at boot by
 * `MeetClientLayer`; the /meet/webhook handler pulls it via Effect.gen.
 */
export class MeetClient extends Context.Tag("MeetClient")<MeetClient, MeetClientImpl>() {}
