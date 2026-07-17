// Defensive extraction of a downloadable audio URL from a Recall.ai
// Retrieve Bot response.
//
// Recall's exact media schema varies across API versions and recording
// configs, so rather than hard-code a single path we try, in order:
//   1. a known mixed-audio media shortcut,
//   2. any shortcut whose key mentions "audio",
//   3. any media shortcut with a download_url (mixed video carries audio).
// Returns undefined if none is found. Pure and unit-tested so the exact
// path can be re-confirmed against a real Recall response without touching
// the network code.

interface MediaData {
  readonly download_url?: string;
}
interface MediaShortcut {
  readonly data?: MediaData;
}

export interface RecallBotRecording {
  readonly media_shortcuts?: Record<string, MediaShortcut | undefined>;
}

export interface RecallBotResponse {
  readonly recordings?: ReadonlyArray<RecallBotRecording>;
}

const urlOf = (s: MediaShortcut | undefined): string | undefined => {
  const url = s?.data?.download_url;
  return typeof url === "string" && url.length > 0 ? url : undefined;
};

export const extractAudioDownloadUrl = (json: RecallBotResponse): string | undefined => {
  const recordings = json.recordings ?? [];

  // 1. Prefer an explicit mixed-audio shortcut. `audio_mixed_mp3` is the key
  // our recording_config requests (Recall mirrors recording_config keys into
  // media_shortcuts verbatim), so match it exactly before the substring scan.
  const preferredKeys = ["audio_mixed_mp3", "audio_mixed", "audio_separate_mp3", "audio"];
  for (const rec of recordings) {
    const shortcuts = rec.media_shortcuts ?? {};
    for (const key of preferredKeys) {
      const url = urlOf(shortcuts[key]);
      if (url) return url;
    }
  }

  // 2. Any shortcut whose key mentions audio.
  for (const rec of recordings) {
    const shortcuts = rec.media_shortcuts ?? {};
    for (const [key, shortcut] of Object.entries(shortcuts)) {
      if (key.toLowerCase().includes("audio")) {
        const url = urlOf(shortcut);
        if (url) return url;
      }
    }
  }

  // 3. Any media at all (mixed video carries audio).
  for (const rec of recordings) {
    const shortcuts = rec.media_shortcuts ?? {};
    for (const shortcut of Object.values(shortcuts)) {
      const url = urlOf(shortcut);
      if (url) return url;
    }
  }

  return undefined;
};
