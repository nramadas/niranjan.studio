// Constants shared across the Google Meet ingestion units.

/** The Workspace Events type fired when Meet finishes generating a transcript. */
export const MEET_TRANSCRIPT_FILE_GENERATED = "google.workspace.meet.transcript.v2.fileGenerated";

/**
 * Prefix of the Workspace Events *subscription lifecycle* event types
 * (expirationReminder, expired, suspended, ...) that Google delivers to the
 * same Pub/Sub topic as the Meet events themselves.
 */
export const SUBSCRIPTION_LIFECYCLE_PREFIX = "google.workspace.events.subscription.v1.";
