import { z } from "zod";
import { Effect, type Runtime } from "effect";
import { Vault } from "../../couchdb/vault.js";
import { SearchIndex } from "../../search/index.js";
import { runTool } from "../tool-runtime.js";

type R = Runtime.Runtime<Vault | SearchIndex>;

export const createNoteInputShape = {
  path: z.string().min(1).describe("Vault-relative path for the new note. Must include the file extension."),
  body: z.string().describe("Markdown body of the note. May be empty."),
  frontmatter: z
    .record(z.unknown())
    .optional()
    .describe(
      "Optional YAML frontmatter, as a flat key/value object. Renders to the standard `---\\nkey: value\\n---` block at the top of the note.",
    ),
} as const;

export const createNoteConfig = {
  title: "Create note",
  description:
    "Create a new note at the given vault-relative path. Fails with NoteConflictError if a note already exists at that path — use update_note to modify an existing note. The note will be encrypted with the vault's E2EE passphrase before being written to CouchDB, and any LiveSync clients will pick it up on their next sync cycle.",
  inputSchema: createNoteInputShape,
};

export const createNoteHandler =
  (runtime: R) =>
  async (args: { path: string; body: string; frontmatter?: Record<string, unknown> }) =>
    runTool(runtime)(
      Effect.gen(function* () {
        const vault = yield* Vault;
        return yield* vault.createNote(args.path, args.body, args.frontmatter);
      }),
    );
