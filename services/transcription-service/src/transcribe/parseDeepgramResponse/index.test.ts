import { describe, expect, it } from "vitest";
import { parseDeepgramResponse } from "./index.ts";

describe("parseDeepgramResponse", () => {
  it("maps utterances into speaker-labelled segments", () => {
    const r = parseDeepgramResponse(
      {
        results: {
          utterances: [
            { start: 0, end: 2.5, transcript: "Hello there.", speaker: 0 },
            { start: 2.6, end: 5, transcript: "Hi, how are you?", speaker: 1 },
          ],
          channels: [{ detected_language: "en" }],
        },
        metadata: { duration: 5 },
      },
      "deepgram-nova-3",
    );
    expect(r.segments).toHaveLength(2);
    expect(r.segments[0]).toEqual({ speaker: 0, start: 0, end: 2.5, text: "Hello there." });
    expect(r.segments[1]?.speaker).toBe(1);
    expect(r.language).toBe("en");
    expect(r.durationSec).toBe(5);
    expect(r.modelName).toBe("deepgram-nova-3");
  });

  it("defaults a missing speaker to 0 and skips empty utterances", () => {
    const r = parseDeepgramResponse(
      {
        results: {
          utterances: [
            { start: 0, end: 1, transcript: "   " },
            { start: 1, end: 2, transcript: "Real text", speaker: 3 },
          ],
        },
      },
      "deepgram-nova-3",
    );
    expect(r.segments).toHaveLength(1);
    expect(r.segments[0]).toEqual({ speaker: 3, start: 1, end: 2, text: "Real text" });
  });

  it("falls back to the top channel alternative when there are no utterances", () => {
    const r = parseDeepgramResponse(
      {
        results: { channels: [{ alternatives: [{ transcript: "Single block transcript" }] }] },
        metadata: { duration: 12 },
      },
      "deepgram-nova-3",
    );
    expect(r.segments).toEqual([
      { speaker: 0, start: 0, end: 12, text: "Single block transcript" },
    ]);
  });

  it("returns an empty segment list when there is no transcript at all", () => {
    const r = parseDeepgramResponse({ results: {} }, "deepgram-nova-3");
    expect(r.segments).toEqual([]);
  });
});
