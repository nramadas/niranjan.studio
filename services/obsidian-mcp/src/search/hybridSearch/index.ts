import { Cause, Effect } from "effect";
import { IndexerClient } from "../IndexerClient";
import { SearchIndex } from "../SearchIndex";
import { reciprocalRankFusion } from "../reciprocalRankFusion";

export interface HybridHit {
  readonly path: string;
  readonly title: string;
  readonly score: number;
  readonly snippet: string;
  /** Which arm(s) of the hybrid this hit came from. Useful for debugging. */
  readonly source: ReadonlyArray<"lexical" | "semantic">;
}

export type SearchMode = "lexical" | "semantic" | "hybrid";

const titleFromPath = (p: string): string => {
  const base = p.split("/").pop() ?? p;
  return base.replace(/\.md$/i, "");
};

/**
 * Hybrid retrieval: run the existing BM25 (`SearchIndex`) arm and the
 * vault-indexer's semantic arm in parallel via `Effect.all`, then fuse
 * the ranked lists with Reciprocal Rank Fusion.
 *
 * Degradation contract:
 *   - `mode="hybrid"` (default): both arms run; if the indexer fails
 *     (timeout / 5xx / network), the failure is caught, logged, and the
 *     result becomes BM25-only with a `source: ["lexical"]` flag on every
 *     hit. The MCP tool MUST NOT fail in this case.
 *   - `mode="lexical"`: indexer is skipped entirely.
 *   - `mode="semantic"`: BM25 is skipped entirely; indexer failures
 *     propagate (caller asked for semantic, can't paper over absence).
 *
 * Result hits carry a `source` array indicating which arms contributed
 * to the ranking. Snippets prefer the BM25 snippet (it's already
 * highlighted) but fall back to the semantic chunk text.
 *
 * @param query  User query string.
 * @param limit  Maximum hits to return after fusion.
 * @param mode   See above.
 */
export const hybridSearch = (query: string, limit: number, mode: SearchMode) =>
  Effect.gen(function* () {
    const lexicalEffect =
      mode === "semantic"
        ? Effect.succeed(
            [] as ReadonlyArray<{ path: string; title: string; score: number; snippet: string }>,
          )
        : Effect.flatMap(SearchIndex, (idx) => idx.query(query, limit * 2));

    const semanticEffect =
      mode === "lexical"
        ? Effect.succeed(
            [] as ReadonlyArray<{
              notePath: string;
              chunkIndex: number;
              chunkText: string;
              score: number;
            }>,
          )
        : Effect.flatMap(IndexerClient, (c) => c.search(query, limit * 2)).pipe(
            Effect.catchTag("IndexerUnavailableError", (err) =>
              mode === "semantic"
                ? Effect.fail(err)
                : Effect.logWarning(
                    `indexer unavailable (${err.reason}); falling back to lexical-only: ${err.message}`,
                  ).pipe(Effect.as([])),
            ),
          );

    const [lexicalHits, semanticHits] = yield* Effect.all([lexicalEffect, semanticEffect], {
      concurrency: 2,
    });

    if (mode === "lexical") {
      return lexicalHits.slice(0, limit).map<HybridHit>((h) => ({ ...h, source: ["lexical"] }));
    }

    if (mode === "semantic") {
      return semanticHits.slice(0, limit).map<HybridHit>((h) => ({
        path: h.notePath,
        title: titleFromPath(h.notePath),
        score: h.score,
        snippet: h.chunkText.slice(0, 200),
        source: ["semantic"],
      }));
    }

    // mode === "hybrid": RRF over the two ranked lists, deduplicated by note path.
    const lexicalRanked = lexicalHits.map((h) => ({
      id: h.path,
      value: {
        path: h.path,
        title: h.title,
        snippet: h.snippet,
        semanticText: undefined as string | undefined,
      },
    }));
    const semanticRanked = semanticHits.map((h) => ({
      id: h.notePath,
      value: {
        path: h.notePath,
        title: titleFromPath(h.notePath),
        snippet: h.chunkText.slice(0, 200),
        semanticText: h.chunkText as string | undefined,
      },
    }));

    const fused = reciprocalRankFusion<{
      path: string;
      title: string;
      snippet: string;
      semanticText?: string;
    }>([lexicalRanked, semanticRanked]);

    const lexicalIds = new Set(lexicalRanked.map((r) => r.id));
    const semanticIds = new Set(semanticRanked.map((r) => r.id));

    return fused.slice(0, limit).map<HybridHit>((f) => {
      const source: ("lexical" | "semantic")[] = [];
      if (lexicalIds.has(f.id)) source.push("lexical");
      if (semanticIds.has(f.id)) source.push("semantic");
      return {
        path: f.value.path,
        title: f.value.title,
        score: Number(f.score.toFixed(6)),
        snippet: f.value.snippet,
        source,
      };
    });
  }).pipe(
    Effect.tapErrorCause((cause) => Effect.logError(`hybridSearch failed: ${Cause.pretty(cause)}`)),
  );
