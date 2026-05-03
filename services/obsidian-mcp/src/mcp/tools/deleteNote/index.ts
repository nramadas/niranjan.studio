import { Effect } from "effect";
import { z } from "zod";
import { Vault } from "../../../couchdb/Vault";
import { runTool } from "../../runTool";
import type { ServerRuntime } from "../../types.ts";

const inputShape = {
  path: z.string().min(1).describe("Vault-relative path of the note to delete."),
} as const;

const config = {
  title: "Delete note (soft)",
  description:
    "Soft-delete a note by moving it to a `.trash/` folder inside the vault. The original note is removed from its location, but the content is preserved under `.trash/<original-path>` in case the deletion was a mistake. Manually empty `.trash/` from Obsidian when you're sure. Fails with NoteNotFoundError if the path doesn't exist.",
  inputSchema: inputShape,
};

const handler = (runtime: ServerRuntime) => async (args: { path: string }) =>
  runTool(runtime, "delete_note")(
    Effect.gen(function* () {
      const vault = yield* Vault;
      yield* vault.deleteNote(args.path);
      return { ok: true, path: args.path } as const;
    }),
  );

/**
 * The `delete_note` MCP tool registration. Returns the tool name, the
 * SDK-shaped config, and a handler factory closing over the captured
 * Effect runtime.
 */
export const deleteNote = (runtime: ServerRuntime) => ({
  name: "delete_note" as const,
  config,
  handler: handler(runtime),
});
