import { Effect } from "effect";
import { z } from "zod";
import { SearchIndex } from "../../../search/SearchIndex";
import { runTool } from "../../runTool";
import type { ServerRuntime } from "../../types.ts";

const inputShape = {
  query: z
    .string()
    .min(1)
    .describe("Free-text search query. Tokens are matched against note titles and bodies."),
  limit: z
    .number()
    .int()
    .positive()
    .max(50)
    .default(10)
    .describe("Maximum number of hits to return."),
} as const;

const config = {
  title: "Search notes",
  description:
    "Full-text search across the entire vault using a BM25 index over note titles (weighted 2x) and bodies. Returns ranked results with relevance scores and a short snippet around the first matching token. Use this when you don't know the exact note path but remember keywords from its content.",
  inputSchema: inputShape,
};

const handler =
  (runtime: ServerRuntime) =>
  async (args: { query: string; limit?: number }) =>
    runTool(runtime, "search_notes")(
      Effect.gen(function* () {
        const idx = yield* SearchIndex;
        return yield* idx.query(args.query, args.limit ?? 10);
      }),
    );

/**
 * The `search_notes` MCP tool registration. Returns the tool name, the
 * SDK-shaped config, and a handler factory closing over the captured
 * Effect runtime.
 */
export const searchNotes = (runtime: ServerRuntime) => ({
  name: "search_notes" as const,
  config,
  handler: handler(runtime),
});
