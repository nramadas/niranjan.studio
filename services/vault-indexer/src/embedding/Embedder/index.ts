import { Context, type Effect } from "effect";
import { EmbeddingError } from "../../lib/errors/EmbeddingError";
import type { EmbeddingVector } from "../types.ts";

/**
 * The shape of an embedder. Implementations may run the model
 * in-process (bge-small via ONNX), or call out to a hosted API
 * (OpenAI). The interface is identical so the rest of the indexer
 * (chunking, store, query) is model-agnostic.
 *
 * Vectors returned by `embed` MUST be L2-normalised (unit length) — the
 * vector store's default L2 distance produces cosine-equivalent ordering
 * only on unit vectors. Implementations are responsible for normalising
 * before returning, not the caller.
 */
export interface EmbedderImpl {
  /** Stable model identifier, e.g. "bge-small-en-v1.5" or "text-embedding-3-small". */
  readonly modelName: string;
  /** Implementation-defined version string. Drives the taintedness check on boot. */
  readonly modelVersion: string;
  /** Dimensionality of the produced vectors. Drives the SQL schema. */
  readonly dimensions: number;
  /**
   * Embed a batch of strings. Inputs are concatenated paragraph/chunk
   * text; outputs are unit-length vectors of length `dimensions`. Returns
   * one vector per input, in the same order. Fails with EmbeddingError if
   * the model rejects the batch or an HTTP call to a remote provider
   * fails.
   */
  readonly embed: (
    texts: ReadonlyArray<string>,
  ) => Effect.Effect<ReadonlyArray<EmbeddingVector>, EmbeddingError>;
}

/**
 * The Embedder Effect Context tag. Wired in at boot by `selectEmbedderLayer`;
 * the changes pipeline, backfill, and search query path all pull it via
 * `Effect.gen`.
 */
export class Embedder extends Context.Tag("Embedder")<Embedder, EmbedderImpl>() {}
