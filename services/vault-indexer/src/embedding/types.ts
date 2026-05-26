// Cross-cutting types for the embedding module.

/**
 * A unit-length embedding vector. The store's L2 distance is
 * cosine-equivalent only when both query and corpus vectors are
 * L2-normalised, so every Embedder implementation MUST return vectors
 * already normalised — the contract is documented on the Embedder
 * interface and enforced via a wrapper in `l2Normalise`.
 */
export type EmbeddingVector = ReadonlyArray<number>;
