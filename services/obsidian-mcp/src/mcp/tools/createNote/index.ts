import { Vault } from "@niranjan/vault-shared/couchdb";
import { Effect } from "effect";
import { z } from "zod";
import { runTool } from "../../runTool";
import type { ServerRuntime } from "../../types.ts";

const inputShape = {
  path: z
    .string()
    .min(1)
    .describe("Vault-relative path for the new note. Must include the file extension."),
  body: z.string().describe("Markdown body of the note. May be empty."),
  frontmatter: z
    .record(z.unknown())
    .optional()
    .describe(
      'Optional YAML frontmatter as a flat key/value object. Renders to the standard `---\\nkey: value\\n---` block at the top of the note. Pass list-valued keys (like `tags`, `aliases`) as JSON arrays — `{"tags": ["draft", "idea"]}` becomes `tags: [draft, idea]` in YAML, which Obsidian parses as a real list. Strings, numbers, booleans, and null are written as YAML scalars; strings containing colons or other YAML-reserved characters are automatically quoted.',
    ),
} as const;

const config = {
  title: "Create note",
  description:
    "Create a new note at the given vault-relative path. Fails with NoteConflictError if a note already exists at that path — use update_note to modify an existing note. The note will be encrypted with the vault's E2EE passphrase before being written to CouchDB, and any LiveSync clients will pick it up on their next sync cycle.",
  inputSchema: inputShape,
};

const handler =
  (runtime: ServerRuntime) =>
  async (args: { path: string; body: string; frontmatter?: Record<string, unknown> }) =>
    runTool(
      runtime,
      "create_note",
    )(
      Effect.gen(function* () {
        const vault = yield* Vault;
        return yield* vault.createNote(args.path, args.body, args.frontmatter);
      }),
    );

/**
 * The `create_note` MCP tool registration. Returns the tool name, the
 * SDK-shaped config, and a handler factory closing over the captured
 * Effect runtime.
 */
export const createNote = (runtime: ServerRuntime) => ({
  name: "create_note" as const,
  config,
  handler: handler(runtime),
});
