import { z } from "zod";
import { Effect, type Runtime } from "effect";
import { Vault } from "../../couchdb/vault.js";
import { SearchIndex } from "../../search/index.js";
import { runTool } from "../tool-runtime.js";

type R = Runtime.Runtime<Vault | SearchIndex>;

export const deleteNoteInputShape = {
  path: z.string().min(1).describe("Vault-relative path of the note to delete."),
} as const;

export const deleteNoteConfig = {
  title: "Delete note (soft)",
  description:
    "Soft-delete a note by moving it to a `.trash/` folder inside the vault. The original note is removed from its location, but the content is preserved under `.trash/<original-path>` in case the deletion was a mistake. Manually empty `.trash/` from Obsidian when you're sure. Fails with NoteNotFoundError if the path doesn't exist.",
  inputSchema: deleteNoteInputShape,
};

export const deleteNoteHandler =
  (runtime: R) =>
  async (args: { path: string }) =>
    runTool(runtime)(
      Effect.gen(function* () {
        const vault = yield* Vault;
        yield* vault.deleteNote(args.path);
        return { ok: true, path: args.path } as const;
      }),
    );
