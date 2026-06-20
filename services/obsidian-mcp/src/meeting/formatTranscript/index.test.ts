import { describe, expect, it } from "vitest";
import { formatTranscript } from "./index.ts";

describe("formatTranscript", () => {
  const meta = {
    title: "Weekly sync",
    botId: "bot-123",
    stt: "deepgram-nova-3",
    platform: "google-meet",
    startedAt: "2026-06-18T14:00:00Z",
    durationSec: 1830,
    participants: ["Alice", "Bob"],
    language: "en",
  };

  it("builds a dated path under the folder", () => {
    const out = formatTranscript([], meta, "Meetings", "2026-06-18");
    expect(out.path).toBe("Meetings/2026-06-18 — Weekly sync.md");
  });

  it("emits the expected frontmatter", () => {
    const out = formatTranscript([], meta, "Meetings", "2026-06-18");
    expect(out.frontmatter).toEqual({
      type: "meeting-transcript",
      source: "recall",
      date: "2026-06-18",
      bot_id: "bot-123",
      stt: "deepgram-nova-3",
      platform: "google-meet",
      start: "2026-06-18T14:00:00Z",
      duration_min: 31,
      participants: ["Alice", "Bob"],
      language: "en",
    });
  });

  it("renders speaker turns with timestamps", () => {
    const out = formatTranscript(
      [
        { speaker: 0, start: 0, end: 3, text: "Hello." },
        { speaker: 1, start: 65, end: 70, text: "Hi there." },
      ],
      meta,
      "Meetings",
      "2026-06-18",
    );
    expect(out.body).toContain("# Weekly sync");
    expect(out.body).toContain("**Speaker 0** (0:00): Hello.");
    expect(out.body).toContain("**Speaker 1** (1:05): Hi there.");
  });

  it("notes when there was no speech", () => {
    const out = formatTranscript([], meta, "Meetings", "2026-06-18");
    expect(out.body).toContain("_No speech was detected in this recording._");
  });

  it("omits optional frontmatter when absent and sanitizes the title", () => {
    const out = formatTranscript(
      [],
      { title: "Q3: plan/review?", botId: "b", stt: "deepgram-nova-3" },
      "Meetings",
      "2026-06-18",
    );
    expect(out.path).toBe("Meetings/2026-06-18 — Q3 plan review.md");
    expect(out.frontmatter).toEqual({
      type: "meeting-transcript",
      source: "recall",
      date: "2026-06-18",
      bot_id: "b",
      stt: "deepgram-nova-3",
    });
  });
});
