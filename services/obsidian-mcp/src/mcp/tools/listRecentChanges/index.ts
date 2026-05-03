import { Effect } from "effect";
import { z } from "zod";
import { Vault } from "../../../couchdb/Vault";
import { runTool } from "../../runTool";
import type { ServerRuntime } from "../../types.ts";

const inputShape = {
  limit: z
    .number()
    .int()
    .positive()
    .max(100)
    .default(20)
    .describe("Maximum number of recent notes to return."),
} as const;

const config = {
  title: "List recent changes",
  description:
    "Return the N most recently modified notes in the vault, ordered most-recent-first. Useful when picking up a conversation about whatever the user was just working on, or when surfacing today's daily notes.",
  inputSchema: inputShape,
};

const handler = (runtime: ServerRuntime) => async (args: { limit?: number }) =>
  runTool(runtime, "list_recent_changes")(
    Effect.gen(function* () {
      const vault = yield* Vault;
      return yield* vault.listRecent(args.limit ?? 20);
    }),
  );

/**
 * The `list_recent_changes` MCP tool registration. Returns the tool name,
 * the SDK-shaped config, and a handler factory closing over the captured
 * Effect runtime.
 */
export const listRecentChanges = (runtime: ServerRuntime) => ({
  name: "list_recent_changes" as const,
  config,
  handler: handler(runtime),
});
