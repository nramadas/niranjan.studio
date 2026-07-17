import { describe, expect, it } from "vitest";
import { extractAudioDownloadUrl } from "./index.ts";

describe("extractAudioDownloadUrl", () => {
  it("prefers the mixed-audio shortcut", () => {
    const url = extractAudioDownloadUrl({
      recordings: [
        {
          media_shortcuts: {
            video_mixed: { data: { download_url: "https://x/video.mp4" } },
            audio_mixed: { data: { download_url: "https://x/audio.mp3" } },
          },
        },
      ],
    });
    expect(url).toBe("https://x/audio.mp3");
  });

  it("matches the configured audio_mixed_mp3 key even alongside another audio shortcut", () => {
    const url = extractAudioDownloadUrl({
      recordings: [
        {
          media_shortcuts: {
            audio_separate_raw: { data: { download_url: "https://x/raw.wav" } },
            audio_mixed_mp3: { data: { download_url: "https://x/mixed.mp3" } },
          },
        },
      ],
    });
    expect(url).toBe("https://x/mixed.mp3");
  });

  it("falls back to any audio-keyed shortcut", () => {
    const url = extractAudioDownloadUrl({
      recordings: [
        { media_shortcuts: { my_audio_track: { data: { download_url: "https://x/a.wav" } } } },
      ],
    });
    expect(url).toBe("https://x/a.wav");
  });

  it("falls back to any media download_url when no audio key exists", () => {
    const url = extractAudioDownloadUrl({
      recordings: [
        { media_shortcuts: { video_mixed: { data: { download_url: "https://x/v.mp4" } } } },
      ],
    });
    expect(url).toBe("https://x/v.mp4");
  });

  it("returns undefined when there is no downloadable media", () => {
    expect(extractAudioDownloadUrl({ recordings: [{ media_shortcuts: {} }] })).toBeUndefined();
    expect(extractAudioDownloadUrl({})).toBeUndefined();
  });
});
