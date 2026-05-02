import { z } from "zod";
import { Effect, type Runtime } from "effect";
import { Vault } from "../../couchdb/vault.js";
import { SearchIndex } from "../../search/index.js";
import { runTool } from "../tool-runtime.js";

type R = Runtime.Runtime<Vault | SearchIndex>;

export const readNoteInputShape = {
  path: z
    .string()
    .min(1)
    .describe("Vault-relative path of the note (e.g. `Daily/2026-05-01.md`)."),
} as const;

export const readNoteConfig = {
  title: "Read note",
  description:
    "Read a single note by its vault-relative path. Returns the parsed YAML frontmatter as a structured object plus the note body as a string. Fails with NoteNotFoundError if the note does not exist.",
  inputSchema: readNoteInputShape,
};

export const readNoteHandler =
  (runtime: R) =>
  async (args: { path: string }) =>
    runTool(runtime)(
      Effect.gen(function* () {
        const vault = yield* Vault;
        return yield* vault.readNote(args.path);
      }),
    );
