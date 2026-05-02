import { Effect } from "effect";
import { z } from "zod";
import { Vault } from "../../../couchdb/Vault";
import { runTool } from "../../runTool";
import type { ServerRuntime } from "../../types.ts";

const inputShape = {
  folder_prefix: z
    .string()
    .optional()
    .describe(
      "Optional vault-relative path prefix (e.g. `Daily/`). Only notes whose path starts with this prefix are returned.",
    ),
  limit: z.number().int().positive().max(500).default(100).describe("Maximum number of notes to return."),
} as const;

const config = {
  title: "List notes",
  description:
    "List notes in the Obsidian vault, optionally filtered by folder prefix. Returns paths and titles only — call read_note for the contents. Use this when you need an overview of the vault or want to discover what notes exist under a specific folder.",
  inputSchema: inputShape,
};

const handler =
  (runtime: ServerRuntime) =>
  async (args: { folder_prefix?: string; limit?: number }) =>
    runTool(runtime)(
      Effect.gen(function* () {
        const vault = yield* Vault;
        const limit = args.limit ?? 100;
        return yield* vault.listNotes(args.folder_prefix, limit);
      }),
    );

/**
 * The `list_notes` MCP tool registration. Returns the tool name, the
 * config object the SDK expects (title, description, input schema), and
 * a handler factory that closes over the captured Effect runtime.
 *
 * Bundles input shape + config + handler into a single registration
 * object because they're three pieces of data supporting one
 * registration, not three separate functions (per the styleguide rule
 * for co-located supporting data).
 */
export const listNotes = (runtime: ServerRuntime) => ({
  name: "list_notes" as const,
  config,
  handler: handler(runtime),
});
