import { describe, expect, it } from "vitest";
import {
  extractParticipantEventsUrls,
  parseParticipantsArtifact,
  parseSpeakerTimeline,
} from "./index.ts";

describe("extractParticipantEventsUrls", () => {
  it("pulls the timeline + participants URLs from media_shortcuts", () => {
    const json = {
      recordings: [
        {
          media_shortcuts: {
            participant_events: {
              data: {
                speaker_timeline_download_url: "https://s3/timeline.json",
                participants_download_url: "https://s3/participants.json",
              },
            },
          },
        },
      ],
    };
    expect(extractParticipantEventsUrls(json)).toEqual({
      speakerTimelineUrl: "https://s3/timeline.json",
      participantsUrl: "https://s3/participants.json",
    });
  });

  it("also reads participant_events directly off the recording", () => {
    const json = {
      recordings: [
        { participant_events: { data: { speaker_timeline_download_url: "https://s3/t.json" } } },
      ],
    };
    expect(extractParticipantEventsUrls(json).speakerTimelineUrl).toBe("https://s3/t.json");
  });

  it("returns empty when the artifact is absent", () => {
    expect(extractParticipantEventsUrls({ recordings: [{ media_shortcuts: {} }] })).toEqual({});
    expect(extractParticipantEventsUrls({})).toEqual({});
  });
});

describe("parseSpeakerTimeline", () => {
  it("maps entries to name + relative-second intervals", () => {
    const json = [
      {
        participant: { id: 1, name: "Alice" },
        start_timestamp: { absolute: "2026-06-18T14:00:00Z", relative: 0 },
        end_timestamp: { absolute: "2026-06-18T14:00:05Z", relative: 5 },
      },
      {
        participant: { id: 2, name: "Bob" },
        start_timestamp: { relative: 6 },
        end_timestamp: { relative: 10 },
      },
    ];
    expect(parseSpeakerTimeline(json)).toEqual([
      { name: "Alice", start: 0, end: 5 },
      { name: "Bob", start: 6, end: 10 },
    ]);
  });

  it("drops entries with no name, missing times, or inverted intervals", () => {
    const json = [
      {
        participant: { name: null },
        start_timestamp: { relative: 0 },
        end_timestamp: { relative: 5 },
      },
      { participant: { name: "Bob" }, end_timestamp: { relative: 5 } },
      {
        participant: { name: "Carol" },
        start_timestamp: { relative: 9 },
        end_timestamp: { relative: 8 },
      },
    ];
    expect(parseSpeakerTimeline(json)).toEqual([]);
  });

  it("returns [] for non-array input", () => {
    expect(parseSpeakerTimeline(null)).toEqual([]);
    expect(parseSpeakerTimeline({})).toEqual([]);
  });
});

describe("parseParticipantsArtifact", () => {
  it("returns de-duped, trimmed names", () => {
    const json = [
      { id: 1, name: "Alice" },
      { id: 2, name: " Bob " },
      { id: 3, name: "Alice" },
      { id: 4, name: null },
    ];
    expect(parseParticipantsArtifact(json)).toEqual(["Alice", "Bob"]);
  });

  it("returns [] for non-array input", () => {
    expect(parseParticipantsArtifact("nope")).toEqual([]);
  });
});
