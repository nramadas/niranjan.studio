import { Data } from "effect";

/**
 * Raised at boot when the on-disk SQLite file's recorded embedding model
 * does not match the embedder the running container was configured with.
 * The indexer must fail loud here — silently mixing vectors from two
 * different models in the same store would produce ranked KNN results
 * that look fine but are semantically incoherent.
 *
 * The recovery path is one of:
 *   1. Reconfigure the container to use the model the file was built with,
 *      OR
 *   2. Delete the file and re-run the backfill under the new model.
 *
 * Documented at length in docs/vault-indexer/embedding-model.md §
 * "Migrating to a new model".
 *
 * @property expected     `{ model, version, dim }` the running container expected.
 * @property found        `{ model, version, dim }` the on-disk file declares.
 */
export class VectorStoreSchemaError extends Data.TaggedError("VectorStoreSchemaError")<{
  readonly expected: { readonly model: string; readonly version: string; readonly dim: number };
  readonly found: { readonly model: string; readonly version: string; readonly dim: number };
}> {}
