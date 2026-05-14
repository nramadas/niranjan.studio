import { Effect } from "effect";
import { z } from "zod";
import { Vault } from "../../../couchdb/Vault";
import { runTool } from "../../runTool";
import type { ServerRuntime } from "../../types.ts";

const inputShape = {
  path: z.string().min(1).describe("Vault-relative path of the note to edit."),
  old_string: z
    .string()
    .min(1)
    .describe(
      "Exact substring in the note body to replace. Must be present in the body, and unique unless `replace_all` is true. Whitespace and newlines are matched literally — copy the exact text from a prior `read_note` call.",
    ),
  new_string: z
    .string()
    .describe(
      "Replacement text. May be the empty string to delete the matched region. Substituted exactly as supplied; no escaping or interpolation.",
    ),
  replace_all: z
    .boolean()
    .default(false)
    .describe(
      "When true, replaces every occurrence of `old_string` in the body. When false (default), the call fails with StringMatchError if `old_string` appears more than once — protects against accidentally rewriting unintended occurrences.",
    ),
} as const;

const config = {
  title: "Edit note",
  description:
    "Apply a find/replace edit to a note's body without rewriting the whole note. Use this instead of `update_note` when you only need to change a small region — it preserves the rest of the body exactly, avoids the round-trip cost of resending the full content, and reduces the risk of accidentally losing surrounding text. Fails with NoteNotFoundError if the path doesn't exist, or StringMatchError if `old_string` isn't found or is ambiguous. Frontmatter is not searched; use `update_note` to modify frontmatter.",
  inputSchema: inputShape,
};

const handler =
  (runtime: ServerRuntime) =>
  async (args: {
    path: string;
    old_string: string;
    new_string: string;
    replace_all?: boolean;
  }) =>
    runTool(runtime, "edit_note")(
      Effect.gen(function* () {
        const vault = yield* Vault;
        return yield* vault.editNote(
          args.path,
          args.old_string,
          args.new_string,
          args.replace_all ?? false,
        );
      }),
    );

/**
 * The `edit_note` MCP tool registration. Returns the tool name, the
 * SDK-shaped config, and a handler factory closing over the captured
 * Effect runtime.
 */
export const editNote = (runtime: ServerRuntime) => ({
  name: "edit_note" as const,
  config,
  handler: handler(runtime),
});
