// Map Deepgram's anonymous diarization indices (0, 1, 2, …) onto real
// participant names using Recall's speaker timeline. Deepgram clusters voices
// acoustically but cannot name them; Recall knows who was speaking when. Both
// sets of timestamps are seconds from the recording start, so we attribute
// each diarized turn by temporal overlap.
//
// Pure and unit-tested. The webhook handler calls this and hands the resulting
// map to formatTranscript, which prints the name when present and the numeric
// "Speaker N" label when not (e.g. no timeline, or a turn that never overlaps a
// known speaker — common on Meet/Teams where the timeline is sparse).

import type { SpeakerInterval, TranscriptSegment } from "../types.ts";

/**
 * @param segments Diarized transcript segments (numeric speaker + start/end).
 * @param timeline Recall active-speaker intervals (name + start/end seconds).
 * @returns        diarization index -> participant name, for indices that
 *                 confidently overlap exactly one dominant speaker. Indices
 *                 with no overlap are absent (caller keeps "Speaker N").
 */
export const alignSpeakerNames = (
  segments: ReadonlyArray<TranscriptSegment>,
  timeline: ReadonlyArray<SpeakerInterval>,
): ReadonlyMap<number, string> => {
  if (timeline.length === 0) return new Map();

  // speaker index -> (participant name -> total overlapping seconds)
  const overlapBySpeaker = new Map<number, Map<string, number>>();
  for (const seg of segments) {
    for (const iv of timeline) {
      const overlap = Math.min(seg.end, iv.end) - Math.max(seg.start, iv.start);
      if (overlap <= 0) continue;
      const byName = overlapBySpeaker.get(seg.speaker) ?? new Map<string, number>();
      byName.set(iv.name, (byName.get(iv.name) ?? 0) + overlap);
      overlapBySpeaker.set(seg.speaker, byName);
    }
  }

  // Assign each diarization index the participant it overlaps most.
  const names = new Map<number, string>();
  for (const [speaker, byName] of overlapBySpeaker) {
    let best: string | undefined;
    let bestSeconds = 0;
    for (const [name, seconds] of byName) {
      if (seconds > bestSeconds) {
        bestSeconds = seconds;
        best = name;
      }
    }
    if (best !== undefined) names.set(speaker, best);
  }
  return names;
};
