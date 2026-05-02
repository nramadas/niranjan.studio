import { z } from "zod";
import { Effect, type Runtime } from "effect";
import { Vault } from "../../couchdb/vault.js";
import { SearchIndex } from "../../search/index.js";
import { runTool } from "../tool-runtime.js";

type R = Runtime.Runtime<Vault | SearchIndex>;

export const updateNoteInputShape = {
  path: z.string().min(1).describe("Vault-relative path of the existing note to update."),
  body: z
    .string()
    .optional()
    .describe(
      "New markdown body. If omitted, the body is preserved and only frontmatter is updated.",
    ),
  frontmatter: z
    .record(z.unknown())
    .optional()
    .describe(
      "Frontmatter patch — merged with the existing frontmatter (existing keys are overwritten, untouched keys are preserved).",
    ),
} as const;

export const updateNoteConfig = {
  title: "Update note",
  description:
    "Update an existing note. The body, the frontmatter, or both can be updated in a single call. Conflict-aware: reads the current revision before writing, retries once on a 409, then surfaces a NoteConflictError if a concurrent client is racing the write. Fails with NoteNotFoundError if the path doesn't exist.",
  inputSchema: updateNoteInputShape,
};

export const updateNoteHandler =
  (runtime: R) =>
  async (args: { path: string; body?: string; frontmatter?: Record<string, unknown> }) =>
    runTool(runtime)(
      Effect.gen(function* () {
        const vault = yield* Vault;
        return yield* vault.updateNote(args.path, args.body, args.frontmatter);
      }),
    );
