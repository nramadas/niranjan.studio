import { IndexerUnavailableError } from "@niranjan/vault-shared/lib/errors";
import { Context, type Effect } from "effect";

/**
 * One semantic-search hit returned by the indexer's POST /search.
 * Mirrors the indexer's `SemanticHit` shape on the wire. The score is
 * `1 / (1 + distance)` so callers don't need to know the underlying
 * distance metric.
 */
export interface IndexerHit {
  readonly notePath: string;
  readonly chunkIndex: number;
  readonly chunkText: string;
  readonly score: number;
}

/**
 * The shape of the indexer HTTP client. Only one operation: post a
 * query, get ranked hits back. Failures map cleanly to the tagged
 * `IndexerUnavailableError` so the orchestrator can fall back to
 * lexical-only.
 */
export interface IndexerClientImpl {
  readonly search: (
    query: string,
    limit: number,
  ) => Effect.Effect<ReadonlyArray<IndexerHit>, IndexerUnavailableError>;
}

/**
 * The IndexerClient Effect Context tag. Wired in by `IndexerClientLayer`;
 * resolved by `hybridSearch` per request.
 */
export class IndexerClient extends Context.Tag("IndexerClient")<
  IndexerClient,
  IndexerClientImpl
>() {}
