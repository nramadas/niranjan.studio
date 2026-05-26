import { Vault } from "@niranjan/vault-shared/couchdb";
import { Effect } from "effect";
import { z } from "zod";
import { runTool } from "../../runTool";
import type { ServerRuntime } from "../../types.ts";

const inputShape = {
  path: z.string().min(1).describe("Vault-relative path of the note (e.g. `Daily/2026-05-02.md`)."),
} as const;

const config = {
  title: "Read note",
  description:
    "Read a single note by its vault-relative path. Returns the parsed YAML frontmatter as a structured object plus the note body as a string. Fails with NoteNotFoundError if the note does not exist.",
  inputSchema: inputShape,
};

const handler = (runtime: ServerRuntime) => async (args: { path: string }) =>
  runTool(
    runtime,
    "read_note",
  )(
    Effect.gen(function* () {
      const vault = yield* Vault;
      return yield* vault.readNote(args.path);
    }),
  );

/**
 * The `read_note` MCP tool registration. Returns the tool name, the
 * SDK-shaped config, and a handler factory closing over the captured
 * Effect runtime.
 */
export const readNote = (runtime: ServerRuntime) => ({
  name: "read_note" as const,
  config,
  handler: handler(runtime),
});
