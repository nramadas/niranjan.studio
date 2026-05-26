import { Vault } from "@niranjan/vault-shared/couchdb";
import { Effect } from "effect";
import { z } from "zod";
import { runTool } from "../../runTool";
import type { ServerRuntime } from "../../types.ts";

const inputShape = {
  path: z.string().min(1).describe("Vault-relative path of the note to append to."),
  content: z
    .string()
    .min(1)
    .describe(
      "Block of markdown content to append. A newline is inserted between the existing body and the appended content if the body doesn't already end with one.",
    ),
} as const;

const config = {
  title: "Append to note",
  description:
    "Append a block of content to the end of an existing note. Useful for daily-note style workflows or for adding meeting notes / observations without rewriting the whole note. Frontmatter is preserved as-is. Conflict-aware (reads the current revision and retries once on 409).",
  inputSchema: inputShape,
};

const handler = (runtime: ServerRuntime) => async (args: { path: string; content: string }) =>
  runTool(
    runtime,
    "append_to_note",
  )(
    Effect.gen(function* () {
      const vault = yield* Vault;
      return yield* vault.appendToNote(args.path, args.content);
    }),
  );

/**
 * The `append_to_note` MCP tool registration. Returns the tool name, the
 * SDK-shaped config, and a handler factory closing over the captured
 * Effect runtime.
 */
export const appendToNote = (runtime: ServerRuntime) => ({
  name: "append_to_note" as const,
  config,
  handler: handler(runtime),
});
