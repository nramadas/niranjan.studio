// Defensive extraction + parsing of Recall.ai's participant-events artifacts
// from a Retrieve Bot response. Enabling `participant_events: {}` in the
// create-bot recording_config makes Recall attach three download URLs at
// `recordings[].media_shortcuts.participant_events.data.*`; the actual
// participant identities live in the files those URLs point at.
//
// Like extractAudioDownloadUrl, the exact path varies across API versions, so
// we probe defensively and degrade to undefined/[] rather than throwing — the
// caller treats a missing timeline as "no names available" (falls back to
// numeric speaker labels). Pure and unit-tested so the shape can be
// re-confirmed against a real Recall response without touching the network.

import type { SpeakerInterval } from "../types.ts";

export interface ParticipantEventsUrls {
  readonly speakerTimelineUrl?: string;
  readonly participantsUrl?: string;
}

const rec = (v: unknown): Record<string, unknown> | undefined =>
  v !== null && typeof v === "object" ? (v as Record<string, unknown>) : undefined;
const arr = (v: unknown): ReadonlyArray<unknown> => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | undefined =>
  typeof v === "string" && v.length > 0 ? v : undefined;

/**
 * Pull the speaker-timeline + participants download URLs from a Retrieve Bot
 * response. Takes `unknown` and walks defensively because Recall's media schema
 * varies across API versions; both `media_shortcuts.participant_events` and a
 * top-level `participant_events` shape are tolerated.
 */
export const extractParticipantEventsUrls = (json: unknown): ParticipantEventsUrls => {
  const root = rec(json);
  for (const recordingU of arr(root?.recordings)) {
    const recording = rec(recordingU);
    const shortcut =
      rec(rec(recording?.media_shortcuts)?.participant_events) ??
      rec(recording?.participant_events);
    const data = rec(shortcut?.data);
    const speakerTimelineUrl = str(data?.speaker_timeline_download_url);
    const participantsUrl = str(data?.participants_download_url);
    if (speakerTimelineUrl || participantsUrl) return { speakerTimelineUrl, participantsUrl };
  }
  return {};
};

interface TimelineEntry {
  readonly participant?: { readonly name?: unknown };
  readonly start_timestamp?: { readonly relative?: unknown };
  readonly end_timestamp?: { readonly relative?: unknown };
}

/**
 * Parse the speaker-timeline download JSON into active-speaker intervals.
 * `relative` timestamps are seconds from the bot's in_call_recording event —
 * the same origin as the transcribed audio — so these align directly with the
 * transcript's segment times. Entries without a name or a valid interval are
 * dropped.
 */
export const parseSpeakerTimeline = (json: unknown): SpeakerInterval[] => {
  if (!Array.isArray(json)) return [];
  const out: SpeakerInterval[] = [];
  for (const e of json as ReadonlyArray<TimelineEntry>) {
    const rawName = e?.participant?.name;
    const name = typeof rawName === "string" ? rawName.trim() : "";
    const start =
      typeof e?.start_timestamp?.relative === "number" ? e.start_timestamp.relative : undefined;
    const end =
      typeof e?.end_timestamp?.relative === "number" ? e.end_timestamp.relative : undefined;
    if (name && start !== undefined && end !== undefined && end >= start) {
      out.push({ name, start, end });
    }
  }
  return out;
};

interface ParticipantEntry {
  readonly name?: unknown;
}

/** Parse the participants download JSON into a de-duped list of attendee names. */
export const parseParticipantsArtifact = (json: unknown): string[] => {
  if (!Array.isArray(json)) return [];
  const seen = new Set<string>();
  for (const p of json as ReadonlyArray<ParticipantEntry>) {
    const name = typeof p?.name === "string" ? p.name.trim() : "";
    if (name) seen.add(name);
  }
  return [...seen];
};
