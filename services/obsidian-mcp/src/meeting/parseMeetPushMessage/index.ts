import { MEET_TRANSCRIPT_FILE_GENERATED, SUBSCRIPTION_LIFECYCLE_PREFIX } from "../constants.ts";

/** The routes a decoded Pub/Sub push can take in the /meet/webhook handler. */
export type MeetPushMessage =
  | {
      readonly kind: "transcript-file-generated";
      readonly eventType: string;
      /** Resource name: `conferenceRecords/{cr}/transcripts/{t}`. */
      readonly transcriptName: string;
      /**
       * Best-effort: the target resource of the subscription that produced
       * this event (from the CloudEvents `ce-subject`/`ce-source`
       * attributes, when present). Lets the handler try the matching
       * account first; account probing covers deliveries without it.
       */
      readonly targetHint?: string;
    }
  | { readonly kind: "subscription-lifecycle"; readonly eventType: string }
  | { readonly kind: "ignored"; readonly eventType: string };

// A CloudEvents attribute that looks like a Workspace Events target
// resource (user or space) — usable for routing to the owning account.
const isTargetResource = (v: unknown): v is string =>
  typeof v === "string" &&
  (v.startsWith("//cloudidentity.googleapis.com/") || v.startsWith("//meet.googleapis.com/"));

/**
 * Decode a Pub/Sub push-delivery body into the Meet event it carries.
 * Workspace Events arrive CloudEvents-encoded: the event type rides in the
 * `ce-type` message attribute and the changed resource's name in the
 * base64 `message.data` JSON. Everything is read defensively — a malformed
 * or unrecognised delivery becomes `ignored`, never a throw, because the
 * webhook must ack (200) anything that isn't a processable transcript
 * event or Pub/Sub will redeliver it forever.
 *
 * @param body Raw request body of the Pub/Sub push HTTP POST.
 * @returns    The classified message: a transcript-file-generated event
 *             with its transcript resource name, a subscription lifecycle
 *             event (expiration reminder etc.), or `ignored`.
 */
export const parseMeetPushMessage = (body: string): MeetPushMessage => {
  let envelope: {
    message?: { data?: unknown; attributes?: Record<string, unknown> };
  };
  try {
    envelope = JSON.parse(body) as typeof envelope;
  } catch {
    return { kind: "ignored", eventType: "" };
  }

  const attributes = envelope.message?.attributes ?? {};
  const ceType = attributes["ce-type"];

  let data: Record<string, unknown> = {};
  if (typeof envelope.message?.data === "string") {
    try {
      data = JSON.parse(Buffer.from(envelope.message.data, "base64").toString("utf8")) as Record<
        string,
        unknown
      >;
    } catch {
      // Leave data empty; the attribute still tells us the event type.
    }
  }

  // Some delivery modes omit ce-* attributes; fall back to an eventType
  // field inside the decoded payload.
  const eventType =
    typeof ceType === "string" && ceType.length > 0
      ? ceType
      : typeof data.eventType === "string"
        ? data.eventType
        : "";

  if (eventType.startsWith(SUBSCRIPTION_LIFECYCLE_PREFIX)) {
    return { kind: "subscription-lifecycle", eventType };
  }

  if (eventType === MEET_TRANSCRIPT_FILE_GENERATED) {
    const transcript = data.transcript as { name?: unknown } | undefined;
    if (typeof transcript?.name === "string" && transcript.name.length > 0) {
      const targetHint = [attributes["ce-subject"], attributes["ce-source"]].find(isTargetResource);
      return {
        kind: "transcript-file-generated",
        eventType,
        transcriptName: transcript.name,
        ...(targetHint ? { targetHint } : {}),
      };
    }
  }

  return { kind: "ignored", eventType };
};
