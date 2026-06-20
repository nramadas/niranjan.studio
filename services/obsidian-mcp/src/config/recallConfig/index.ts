import { Config } from "effect";

/**
 * Typed config for the Recall.ai meeting-bot client (Phase 4).
 *
 * `apiBase`            — Region host, e.g. https://us-east-1.recall.ai.
 * `apiKey`             — Recall API key (Authorization: Token <key>).
 * `webhookSecret`      — Svix signing secret for the recording-ready
 *                        webhook posted to /recall/webhook; verifies the
 *                        request genuinely came from Recall.
 * `botName`            — Display name the bot joins meetings under. Visible
 *                        to all participants — the consent signal.
 * `transcriptsFolder`  — Vault folder transcripts are filed under.
 * `recordingConfigJson`— The Recall `recording_config` sent on create-bot,
 *                        as JSON. Default captures mixed audio with a short
 *                        timed retention and NO Recall-side transcription
 *                        (STT is the transcription-service's job). Override
 *                        without a code change if Recall's schema differs
 *                        for your account / API version.
 * `timeoutMs`          — Per-request timeout for Recall API calls.
 */
export const recallConfig = Config.all({
  apiBase: Config.string("RECALL_API_BASE").pipe(Config.withDefault("https://us-east-1.recall.ai")),
  apiKey: Config.redacted("RECALL_API_KEY"),
  webhookSecret: Config.redacted("RECALL_WEBHOOK_SECRET"),
  botName: Config.string("RECALL_BOT_NAME").pipe(Config.withDefault("Meeting Transcriber")),
  transcriptsFolder: Config.string("MEETING_TRANSCRIPTS_FOLDER").pipe(
    Config.withDefault("Meetings"),
  ),
  recordingConfigJson: Config.string("RECALL_RECORDING_CONFIG_JSON").pipe(
    Config.withDefault('{"audio_mixed_mp3":{},"retention":{"type":"timed","hours":2}}'),
  ),
  timeoutMs: Config.integer("RECALL_TIMEOUT_MS").pipe(Config.withDefault(15000)),
});
