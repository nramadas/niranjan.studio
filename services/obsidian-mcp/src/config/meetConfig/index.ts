import { Config, Redacted } from "effect";

/**
 * Typed config for Google Meet transcript ingestion (Phase 5).
 *
 * `enabled`            — Master switch. When false the /meet/webhook route
 *                        404s and none of the other values are required, so
 *                        existing deployments keep booting untouched.
 * `pushAudience`       — Expected `aud` of the OIDC token Pub/Sub attaches
 *                        to push deliveries; conventionally the webhook URL
 *                        (https://mcp.<domain>/meet/webhook).
 * `pushServiceAccount` — Service-account email the push subscription signs
 *                        tokens as (meet-push@<project>.iam.gserviceaccount.com).
 * `accountsJson`       — JSON array of the Google accounts to ingest, each
 *                        `{ "name", "refreshToken", "targetResource" }`
 *                        (personal + work both land in the one vault). The
 *                        whole blob is a secret because it carries refresh
 *                        tokens. Parsed and validated at boot by
 *                        `parseMeetAccounts`; entries come from
 *                        scripts/obsidian-mcp/get-google-refresh-token.mjs.
 * `pubsubTopic`        — Topic Google publishes Meet events to
 *                        (projects/{p}/topics/{t}); all accounts'
 *                        subscriptions share it. Used when the service
 *                        (re)creates its own subscriptions.
 * `transcriptsFolder`  — Vault folder transcripts are filed under. Shares
 *                        MEETING_TRANSCRIPTS_FOLDER with the Recall flow so
 *                        bot-captured and Meet-native transcripts sit together.
 * `timeoutMs`          — Per-request timeout for Google API calls.
 */
export const meetConfig = Config.all({
  enabled: Config.boolean("MEET_INGEST_ENABLED").pipe(Config.withDefault(false)),
  pushAudience: Config.string("MEET_PUSH_AUDIENCE").pipe(Config.withDefault("")),
  pushServiceAccount: Config.string("MEET_PUSH_SERVICE_ACCOUNT").pipe(Config.withDefault("")),
  accountsJson: Config.redacted("MEET_ACCOUNTS_JSON").pipe(Config.withDefault(Redacted.make(""))),
  pubsubTopic: Config.string("MEET_PUBSUB_TOPIC").pipe(Config.withDefault("")),
  transcriptsFolder: Config.string("MEETING_TRANSCRIPTS_FOLDER").pipe(
    Config.withDefault("Meetings"),
  ),
  timeoutMs: Config.integer("MEET_TIMEOUT_MS").pipe(Config.withDefault(15000)),
});
