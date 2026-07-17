import { describe, expect, it } from "vitest";
import { parseMeetPushMessage } from "./index.ts";

const encode = (payload: unknown): string =>
  Buffer.from(JSON.stringify(payload), "utf8").toString("base64");

const push = (opts: {
  ceType?: string;
  data?: unknown;
  ceSubject?: string;
  ceSource?: string;
}): string =>
  JSON.stringify({
    message: {
      data: opts.data !== undefined ? encode(opts.data) : undefined,
      attributes: {
        ...(opts.ceType ? { "ce-type": opts.ceType } : {}),
        ...(opts.ceSubject ? { "ce-subject": opts.ceSubject } : {}),
        ...(opts.ceSource ? { "ce-source": opts.ceSource } : {}),
      },
      messageId: "m1",
      publishTime: "2026-07-01T14:32:00Z",
    },
    subscription: "projects/p/subscriptions/s",
  });

describe("parseMeetPushMessage", () => {
  it("extracts the transcript name from a fileGenerated event", () => {
    const out = parseMeetPushMessage(
      push({
        ceType: "google.workspace.meet.transcript.v2.fileGenerated",
        data: { transcript: { name: "conferenceRecords/cr1/transcripts/t1" } },
      }),
    );
    expect(out).toEqual({
      kind: "transcript-file-generated",
      eventType: "google.workspace.meet.transcript.v2.fileGenerated",
      transcriptName: "conferenceRecords/cr1/transcripts/t1",
    });
  });

  it("carries a target hint when ce-subject names the watched user", () => {
    const out = parseMeetPushMessage(
      push({
        ceType: "google.workspace.meet.transcript.v2.fileGenerated",
        ceSubject: "//cloudidentity.googleapis.com/users/222",
        data: { transcript: { name: "conferenceRecords/cr1/transcripts/t1" } },
      }),
    );
    expect(out).toMatchObject({
      kind: "transcript-file-generated",
      targetHint: "//cloudidentity.googleapis.com/users/222",
    });
  });

  it("falls back to ce-source for the target hint when ce-subject is unusable", () => {
    const out = parseMeetPushMessage(
      push({
        ceType: "google.workspace.meet.transcript.v2.fileGenerated",
        ceSubject: "//workspaceevents.googleapis.com/subscriptions/s1",
        ceSource: "//cloudidentity.googleapis.com/users/111",
        data: { transcript: { name: "conferenceRecords/cr1/transcripts/t1" } },
      }),
    );
    expect(out).toMatchObject({
      kind: "transcript-file-generated",
      targetHint: "//cloudidentity.googleapis.com/users/111",
    });
  });

  it("omits the target hint when ce-subject is not a target resource", () => {
    const out = parseMeetPushMessage(
      push({
        ceType: "google.workspace.meet.transcript.v2.fileGenerated",
        ceSubject: "//workspaceevents.googleapis.com/subscriptions/s1",
        data: { transcript: { name: "conferenceRecords/cr1/transcripts/t1" } },
      }),
    );
    expect(out.kind).toBe("transcript-file-generated");
    expect((out as { targetHint?: string }).targetHint).toBeUndefined();
  });

  it("classifies subscription lifecycle events", () => {
    const out = parseMeetPushMessage(
      push({
        ceType: "google.workspace.events.subscription.v1.expirationReminder",
        data: { subscription: { name: "subscriptions/s1" } },
      }),
    );
    expect(out.kind).toBe("subscription-lifecycle");
  });

  it("ignores other meet events", () => {
    const out = parseMeetPushMessage(
      push({
        ceType: "google.workspace.meet.recording.v2.fileGenerated",
        data: { recording: { name: "conferenceRecords/cr1/recordings/r1" } },
      }),
    );
    expect(out.kind).toBe("ignored");
    expect(out.eventType).toBe("google.workspace.meet.recording.v2.fileGenerated");
  });

  it("ignores a fileGenerated event with no transcript name", () => {
    const out = parseMeetPushMessage(
      push({
        ceType: "google.workspace.meet.transcript.v2.fileGenerated",
        data: {},
      }),
    );
    expect(out.kind).toBe("ignored");
  });

  it("falls back to an eventType field in the payload when ce-type is absent", () => {
    const out = parseMeetPushMessage(
      push({
        data: {
          eventType: "google.workspace.meet.transcript.v2.fileGenerated",
          transcript: { name: "conferenceRecords/cr1/transcripts/t1" },
        },
      }),
    );
    expect(out.kind).toBe("transcript-file-generated");
  });

  it("ignores malformed JSON and undecodable data without throwing", () => {
    expect(parseMeetPushMessage("not json").kind).toBe("ignored");
    expect(
      parseMeetPushMessage(
        JSON.stringify({ message: { data: "!!!not-base64-json!!!", attributes: {} } }),
      ).kind,
    ).toBe("ignored");
  });
});
