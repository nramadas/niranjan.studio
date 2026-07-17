import { Config, Redacted } from "effect";

/**
 * Typed config for the Claude-backed transcript digest (todos + dossiers).
 *
 * `apiKey`       — Anthropic API key. Empty (the default) disables digestion
 *                  entirely: transcripts are still ingested, nothing is
 *                  extracted. This keeps the digest an optional add-on rather
 *                  than a boot requirement.
 * `model`        — Claude model id used for both the extract and merge calls.
 * `selfName`     — Whose todos to extract; matched against participant
 *                  display names to skip self-dossiers too.
 * `todoNotePath` — Vault path of the single always-merged TODO note.
 * `peopleFolder` — Vault folder person dossiers are filed under.
 * `timeoutMs`    — Per-request timeout for Claude API calls. Generous by
 *                  default: a long transcript digest is minutes of tokens.
 */
export const digestConfig = Config.all({
  apiKey: Config.redacted("ANTHROPIC_API_KEY").pipe(Config.withDefault(Redacted.make(""))),
  model: Config.string("DIGEST_MODEL").pipe(Config.withDefault("claude-opus-4-8")),
  selfName: Config.string("DIGEST_SELF_NAME").pipe(Config.withDefault("Niranjan")),
  todoNotePath: Config.string("DIGEST_TODO_NOTE_PATH").pipe(Config.withDefault("TODO.md")),
  peopleFolder: Config.string("DIGEST_PEOPLE_FOLDER").pipe(Config.withDefault("People")),
  timeoutMs: Config.integer("DIGEST_TIMEOUT_MS").pipe(Config.withDefault(300000)),
});
