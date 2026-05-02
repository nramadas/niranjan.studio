// Cross-cutting types used by SearchIndex and SearchIndexLayer.

import type { Effect } from "effect";

/** A single search hit returned by the BM25 ranker. */
export interface SearchHit {
  readonly path: string;
  readonly title: string;
  readonly score: number;
  readonly snippet: string;
}

/**
 * The shape of the search index. Two operations: a query (used by the
 * `search_notes` tool) and an invalidation hook (called by the changes
 * feed subscription).
 */
export interface SearchIndexImpl {
  readonly query: (q: string, limit: number) => Effect.Effect<ReadonlyArray<SearchHit>, never>;
  readonly markDirty: () => Effect.Effect<void>;
}
