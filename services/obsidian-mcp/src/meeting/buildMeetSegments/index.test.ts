import { describe, expect, it } from "vitest";
import { buildMeetSegments } from "./index.ts";

const participants = [
  { name: "conferenceRecords/cr1/participants/a", displayName: "Alice" },
  { name: "conferenceRecords/cr1/participants/b", displayName: "Bob" },
];

describe("buildMeetSegments", () => {
  it("assigns stable speaker indices by first appearance and maps names", () => {
    const { segments, speakerNames } = buildMeetSegments(
      [
        {
          participant: "conferenceRecords/cr1/participants/b",
          text: "hi",
          startTime: "2026-07-01T14:00:10Z",
          endTime: "2026-07-01T14:00:12Z",
        },
        {
          participant: "conferenceRecords/cr1/participants/a",
          text: "hello",
          startTime: "2026-07-01T14:00:13Z",
          endTime: "2026-07-01T14:00:15Z",
        },
        {
          participant: "conferenceRecords/cr1/participants/b",
          text: "how are you",
          startTime: "2026-07-01T14:00:16Z",
          endTime: "2026-07-01T14:00:18Z",
        },
      ],
      participants,
      "2026-07-01T14:00:00Z",
    );

    expect(segments.map((s) => s.speaker)).toEqual([0, 1, 0]);
    expect(speakerNames.get(0)).toBe("Bob");
    expect(speakerNames.get(1)).toBe("Alice");
  });

  it("rebases times to seconds from conference start", () => {
    const { segments } = buildMeetSegments(
      [
        {
          participant: "conferenceRecords/cr1/participants/a",
          text: "one",
          startTime: "2026-07-01T14:01:30Z",
          endTime: "2026-07-01T14:01:45Z",
        },
      ],
      participants,
      "2026-07-01T14:00:00Z",
    );
    expect(segments[0]?.start).toBe(90);
    expect(segments[0]?.end).toBe(105);
  });

  it("keeps a monotonic clock when an entry has no parsable time", () => {
    const { segments } = buildMeetSegments(
      [
        {
          participant: "conferenceRecords/cr1/participants/a",
          text: "one",
          startTime: "2026-07-01T14:00:30Z",
          endTime: "2026-07-01T14:00:40Z",
        },
        { participant: "conferenceRecords/cr1/participants/a", text: "two" },
      ],
      participants,
      "2026-07-01T14:00:00Z",
    );
    expect(segments[1]?.start).toBe(40);
    expect(segments[1]?.end).toBe(40);
  });

  it("labels unknown participants with an unmapped speaker index", () => {
    const { segments, speakerNames } = buildMeetSegments(
      [{ text: "who dis", startTime: "2026-07-01T14:00:05Z" }],
      participants,
      "2026-07-01T14:00:00Z",
    );
    expect(segments[0]?.speaker).toBe(0);
    expect(speakerNames.has(0)).toBe(false);
  });

  it("falls back to zero-based times when the conference start is unknown", () => {
    const { segments } = buildMeetSegments(
      [
        {
          participant: "conferenceRecords/cr1/participants/a",
          text: "one",
          startTime: "2026-07-01T14:00:30Z",
        },
      ],
      participants,
      undefined,
    );
    expect(segments[0]?.start).toBe(0);
  });
});
