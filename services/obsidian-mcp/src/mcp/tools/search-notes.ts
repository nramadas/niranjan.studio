import { z } from "zod";
import { Effect, type Runtime } from "effect";
import { Vault } from "../../couchdb/vault.js";
import { SearchIndex } from "../../search/index.js";
import { runTool } from "../tool-runtime.js";

type R = Runtime.Runtime<Vault | SearchIndex>;

export const searchNotesInputShape = {
  query: z
    .string()
    .min(1)
    .describe("Free-text search query. Tokens are matched against note titles and bodies."),
  limit: z.number().int().positive().max(50).default(10).describe("Maximum number of hits to return."),
} as const;

export const searchNotesConfig = {
  title: "Search notes",
  description:
    "Full-text search across the entire vault using a BM25 index over note titles (weighted 2x) and bodies. Returns ranked results with relevance scores and a short snippet around the first matching token. Use this when you don't know the exact note path but remember keywords from its content.",
  inputSchema: searchNotesInputShape,
};

export const searchNotesHandler =
  (runtime: R) =>
  async (args: { query: string; limit?: number }) =>
    runTool(runtime)(
      Effect.gen(function* () {
        const idx = yield* SearchIndex;
        return yield* idx.query(args.query, args.limit ?? 10);
      }),
    );
