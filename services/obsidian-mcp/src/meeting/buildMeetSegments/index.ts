import type { MeetParticipant, MeetTranscriptEntry } from "../MeetClient";
import type { TranscriptSegment } from "../types.ts";

export interface MeetSegments {
  readonly segments: ReadonlyArray<TranscriptSegment>;
  /** Speaker index -> display name, for formatTranscript's labels. */
  readonly speakerNames: ReadonlyMap<number, string>;
}

/**
 * Convert Google Meet transcript entries into the diarized-segment shape the
 * existing transcript formatter consumes. Meet already attributes each
 * utterance to a participant, so unlike the Recall path there is no overlap
 * alignment: each distinct participant gets a stable speaker index (order of
 * first appearance) and the index→name map comes straight from the
 * participants list.
 *
 * Entry times are absolute timestamps; they are rebased to seconds from the
 * conference start so the formatter's `m:ss` labels read as elapsed time.
 * Entries with unparsable times keep the previous entry's time (Meet returns
 * entries ordered by start time, so monotonicity is preserved).
 *
 * @param entries             Transcript entries, in Meet's start-time order.
 * @param participants        Conference participants (resource name + display name).
 * @param conferenceStartTime ISO start of the conference, the zero point.
 * @returns                   Segments plus the speaker-index→name map.
 */
export const buildMeetSegments = (
  entries: ReadonlyArray<MeetTranscriptEntry>,
  participants: ReadonlyArray<MeetParticipant>,
  conferenceStartTime: string | undefined,
): MeetSegments => {
  const nameByResource = new Map<string, string>();
  for (const p of participants) nameByResource.set(p.name, p.displayName);

  const startMs = conferenceStartTime ? Date.parse(conferenceStartTime) : Number.NaN;
  const toSeconds = (iso: string | undefined, fallback: number): number => {
    if (!iso || Number.isNaN(startMs)) return fallback;
    const ms = Date.parse(iso);
    if (Number.isNaN(ms)) return fallback;
    return Math.max(0, (ms - startMs) / 1000);
  };

  const indexBySpeakerKey = new Map<string, number>();
  const speakerNames = new Map<number, string>();
  const segments: TranscriptSegment[] = [];
  let lastEnd = 0;

  for (const entry of entries) {
    const key = entry.participant ?? "unknown";
    let speaker = indexBySpeakerKey.get(key);
    if (speaker === undefined) {
      speaker = indexBySpeakerKey.size;
      indexBySpeakerKey.set(key, speaker);
      const display = entry.participant ? nameByResource.get(entry.participant) : undefined;
      if (display) speakerNames.set(speaker, display);
    }

    const start = toSeconds(entry.startTime, lastEnd);
    const end = Math.max(start, toSeconds(entry.endTime, start));
    lastEnd = end;
    segments.push({ speaker, start, end, text: entry.text });
  }

  return { segments, speakerNames };
};
