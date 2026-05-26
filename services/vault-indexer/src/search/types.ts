// Cross-cutting types for the search module.

/**
 * One hit returned by `semanticSearch`. `score` is higher-is-better,
 * computed as `1 / (1 + distance)` so callers don't need to know whether
 * the underlying metric is L2 or cosine — only the ordering matters.
 */
export interface SemanticHit {
  readonly notePath: string;
  readonly chunkIndex: number;
  readonly chunkText: string;
  readonly score: number;
}
