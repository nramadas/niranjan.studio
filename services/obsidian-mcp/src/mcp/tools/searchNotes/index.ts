import { Effect } from "effect";
import { z } from "zod";
import { hybridSearch } from "../../../search/hybridSearch";
import { runTool } from "../../runTool";
import type { ServerRuntime } from "../../types.ts";

const inputShape = {
  query: z
    .string()
    .min(1)
    .describe("Free-text search query. Matched against note titles, bodies, and semantic meaning."),
  limit: z
    .number()
    .int()
    .positive()
    .max(50)
    .default(10)
    .describe("Maximum number of hits to return."),
  mode: z
    .enum(["lexical", "semantic", "hybrid"])
    .default("hybrid")
    .describe(
      "Search strategy. 'hybrid' (default) fuses BM25 keyword relevance with vector-embedding similarity via reciprocal rank fusion. 'lexical' uses BM25 only (best for exact keywords). 'semantic' uses embeddings only (best when you remember the meaning but not the words).",
    ),
} as const;

const config = {
  title: "Search notes",
  description:
    "Hybrid search across the entire vault. By default fuses BM25 keyword relevance (titles weighted 2x) with semantic vector similarity from an in-process embedding index, ranked via reciprocal rank fusion. Returns ranked hits with note path, title, score, and a short snippet. Use this when you don't know the exact note path: hybrid catches both keyword and meaning matches; switch `mode` if you need only one. If the semantic index is unreachable, hybrid mode degrades to lexical-only with a logged warning rather than failing.",
  inputSchema: inputShape,
};

const handler =
  (runtime: ServerRuntime) =>
  async (args: { query: string; limit?: number; mode?: "lexical" | "semantic" | "hybrid" }) =>
    runTool(
      runtime,
      "search_notes",
    )(
      Effect.gen(function* () {
        return yield* hybridSearch(args.query, args.limit ?? 10, args.mode ?? "hybrid");
      }),
    );

/**
 * The `search_notes` MCP tool registration. Returns the tool name, the
 * SDK-shaped config, and a handler factory closing over the captured
 * Effect runtime. The handler delegates to `hybridSearch`, which
 * orchestrates the BM25 and indexer arms and fuses with RRF.
 */
export const searchNotes = (runtime: ServerRuntime) => ({
  name: "search_notes" as const,
  config,
  handler: handler(runtime),
});
