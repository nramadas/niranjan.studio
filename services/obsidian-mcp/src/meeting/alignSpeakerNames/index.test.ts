import { describe, expect, it } from "vitest";
import type { SpeakerInterval, TranscriptSegment } from "../types.ts";
import { alignSpeakerNames } from "./index.ts";

const seg = (speaker: number, start: number, end: number): TranscriptSegment => ({
  speaker,
  start,
  end,
  text: "x",
});
const iv = (name: string, start: number, end: number): SpeakerInterval => ({ name, start, end });

describe("alignSpeakerNames", () => {
  it("maps each diarization index to the participant it overlaps most", () => {
    const names = alignSpeakerNames(
      [seg(0, 0, 5), seg(1, 6, 10)],
      [iv("Alice", 0, 5), iv("Bob", 6, 10)],
    );
    expect(names.get(0)).toBe("Alice");
    expect(names.get(1)).toBe("Bob");
  });

  it("returns an empty map when there is no timeline", () => {
    expect(alignSpeakerNames([seg(0, 0, 5)], []).size).toBe(0);
  });

  it("leaves an index unmapped when it overlaps nothing", () => {
    const names = alignSpeakerNames([seg(0, 0, 2), seg(1, 100, 105)], [iv("Alice", 0, 2)]);
    expect(names.get(0)).toBe("Alice");
    expect(names.has(1)).toBe(false);
  });

  it("picks the dominant speaker when a turn straddles two", () => {
    // index 0 overlaps Alice for 4s and Bob for 1s -> Alice wins.
    const names = alignSpeakerNames([seg(0, 0, 5)], [iv("Alice", 0, 4), iv("Bob", 4, 5)]);
    expect(names.get(0)).toBe("Alice");
  });

  it("aggregates overlap across multiple segments of the same index", () => {
    const names = alignSpeakerNames(
      [seg(0, 0, 1), seg(0, 10, 14)],
      [iv("Bob", 0, 1), iv("Alice", 10, 14)],
    );
    // Alice: 4s total vs Bob: 1s -> Alice.
    expect(names.get(0)).toBe("Alice");
  });
});
