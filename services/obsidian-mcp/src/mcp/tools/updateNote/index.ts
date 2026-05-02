import { Effect } from "effect";
import { z } from "zod";
import { Vault } from "../../../couchdb/Vault";
import { runTool } from "../../runTool";
import type { ServerRuntime } from "../../types.ts";

const inputShape = {
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

const config = {
  title: "Update note",
  description:
    "Update an existing note. The body, the frontmatter, or both can be updated in a single call. Conflict-aware: reads the current revision before writing, retries once on a 409, then surfaces a NoteConflictError if a concurrent client is racing the write. Fails with NoteNotFoundError if the path doesn't exist.",
  inputSchema: inputShape,
};

const handler =
  (runtime: ServerRuntime) =>
  async (args: { path: string; body?: string; frontmatter?: Record<string, unknown> }) =>
    runTool(runtime)(
      Effect.gen(function* () {
        const vault = yield* Vault;
        return yield* vault.updateNote(args.path, args.body, args.frontmatter);
      }),
    );

/**
 * The `update_note` MCP tool registration. Returns the tool name, the
 * SDK-shaped config, and a handler factory closing over the captured
 * Effect runtime.
 */
export const updateNote = (runtime: ServerRuntime) => ({
  name: "update_note" as const,
  config,
  handler: handler(runtime),
});
