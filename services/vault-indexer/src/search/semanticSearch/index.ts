import { Effect } from "effect";
import { Embedder } from "../../embedding/Embedder";
import { VectorStore } from "../../store/VectorStore";
import type { SemanticHit } from "../types.ts";

/**
 * Run a semantic search: embed the query string, KNN against the vector
 * store, transform the raw distance into a higher-is-better score so
 * downstream consumers (the MCP server's RRF fusion) can rank without
 * knowing the underlying metric.
 *
 * Returns at most `limit` hits, ordered by descending score. Empty
 * query string → empty result (the embedder would otherwise produce a
 * zero-ish vector that doesn't usefully discriminate).
 *
 * @param query Free-text user query.
 * @param limit Maximum hits to return; passed straight through to KNN.
 */
export const semanticSearch = (query: string, limit: number) =>
  Effect.gen(function* () {
    if (query.trim().length === 0) return [] as ReadonlyArray<SemanticHit>;
    const embedder = yield* Embedder;
    const store = yield* VectorStore;

    const [vec] = yield* embedder.embed([query]);
    if (!vec) return [] as ReadonlyArray<SemanticHit>;

    const knn = yield* store.knn(vec, limit);
    const hits: SemanticHit[] = knn.map((h) => ({
      notePath: h.notePath,
      chunkIndex: h.chunkIndex,
      chunkText: h.chunkText,
      score: 1 / (1 + h.distance),
    }));
    return hits;
  });
