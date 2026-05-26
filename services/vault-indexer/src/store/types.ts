import type { Effect } from "effect";
import type { VectorStoreError } from "../lib/errors/VectorStoreError";

/**
 * A chunk row about to be inserted. The `embedding` is the model's
 * output for `text`, already L2-normalised by the Embedder. The store
 * does NOT re-normalise — it trusts the contract documented on the
 * `EmbedderImpl` interface.
 */
export interface StoredChunk {
  readonly hash: string;
  readonly index: number;
  readonly text: string;
  readonly embedding: ReadonlyArray<number>;
}

/**
 * A nearest-neighbour hit. `score` is the raw distance returned by
 * sqlite-vec (lower = closer for L2 / cosine on normalised vectors). The
 * caller-facing `semanticSearch` converts this into a `1 / (1 + distance)`
 * higher-is-better score so the RRF fusion downstream doesn't have to
 * know the metric.
 */
export interface KnnHit {
  readonly notePath: string;
  readonly chunkIndex: number;
  readonly chunkText: string;
  readonly distance: number;
}

/** Identifier pair returned by `listChunkHashesByPath`. */
export interface StoredChunkRef {
  readonly hash: string;
  readonly rowid: number;
}

export interface IndexMeta {
  readonly model: string;
  readonly version: string;
  readonly dim: number;
}

export interface VectorStoreImpl {
  /**
   * Insert the given chunks for `notePath`, then delete any prior
   * chunks of the same note that are no longer present. Insert-before-
   * delete ensures concurrent queries never see a gap.
   *
   * Both phases run inside one transaction; a failure midway leaves
   * the store unchanged.
   */
  readonly upsertChunks: (
    notePath: string,
    noteRevision: string,
    chunks: ReadonlyArray<StoredChunk>,
  ) => Effect.Effect<{ readonly inserted: number; readonly deleted: number }, VectorStoreError>;

  /** Drop every chunk row for `notePath`. Used on note delete. */
  readonly deleteByPath: (notePath: string) => Effect.Effect<number, VectorStoreError>;

  /**
   * Brute-force nearest-neighbour search against the full corpus.
   * Returns the top `k` hits ordered by ascending distance.
   */
  readonly knn: (
    queryVector: ReadonlyArray<number>,
    k: number,
  ) => Effect.Effect<ReadonlyArray<KnnHit>, VectorStoreError>;

  /**
   * Existing chunk hashes for `notePath`. Used by the diff step to
   * decide what's new / stale before re-embedding.
   */
  readonly listChunkHashesByPath: (
    notePath: string,
  ) => Effect.Effect<ReadonlyArray<StoredChunkRef>, VectorStoreError>;

  /** Total chunk count. Useful for `/health` and the indexing-pipeline sanity check. */
  readonly count: () => Effect.Effect<number, VectorStoreError>;

  /** The persisted index metadata. Read once at boot for the taintedness check. */
  readonly meta: () => Effect.Effect<IndexMeta, VectorStoreError>;

  /** Close the SQLite handle. Called from the SIGTERM handler. */
  readonly close: () => Effect.Effect<void, VectorStoreError>;
}
