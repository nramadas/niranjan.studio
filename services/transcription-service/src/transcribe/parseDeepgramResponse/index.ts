import type { TranscriptResult, TranscriptSegment } from "../types.ts";

// The slice of Deepgram's pre-recorded response we actually read. Deepgram
// returns much more; narrowing the interface to what we consume means a
// schema drift surfaces as a typed access here, not a silent undefined
// deep in the mapping.
interface DeepgramUtterance {
  readonly start?: number;
  readonly end?: number;
  readonly transcript?: string;
  readonly speaker?: number;
}

interface DeepgramAlternative {
  readonly transcript?: string;
}

interface DeepgramChannel {
  readonly detected_language?: string;
  readonly alternatives?: ReadonlyArray<DeepgramAlternative>;
}

export interface DeepgramResponse {
  readonly results?: {
    readonly utterances?: ReadonlyArray<DeepgramUtterance>;
    readonly channels?: ReadonlyArray<DeepgramChannel>;
  };
  readonly metadata?: {
    readonly duration?: number;
  };
}

/**
 * Map a Deepgram pre-recorded response (utterances=true & diarize=true)
 * into our backend-agnostic `TranscriptResult`.
 *
 * Primary path: `results.utterances` — already speaker-grouped segments.
 * Fallback: if utterances are absent (diarization off, or a very short
 * clip), synthesise a single segment from the top channel alternative so
 * the caller always gets usable text rather than an empty transcript.
 *
 * Pure and side-effect-free — the network call lives in
 * `DeepgramTranscriberLayer`; this is the unit-tested core.
 *
 * @param json      Parsed Deepgram JSON.
 * @param modelName The model identifier to stamp on the result.
 */
export const parseDeepgramResponse = (
  json: DeepgramResponse,
  modelName: string,
): TranscriptResult => {
  const utterances = json.results?.utterances ?? [];
  const language = json.results?.channels?.[0]?.detected_language;
  const durationSec = json.metadata?.duration;

  if (utterances.length > 0) {
    const segments: TranscriptSegment[] = [];
    for (const u of utterances) {
      const text = (u.transcript ?? "").trim();
      if (text.length === 0) continue;
      segments.push({
        speaker: u.speaker ?? 0,
        start: u.start ?? 0,
        end: u.end ?? u.start ?? 0,
        text,
      });
    }
    return { segments, language, durationSec, modelName };
  }

  const fallback = (json.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? "").trim();
  const segments: TranscriptSegment[] =
    fallback.length > 0 ? [{ speaker: 0, start: 0, end: durationSec ?? 0, text: fallback }] : [];
  return { segments, language, durationSec, modelName };
};
