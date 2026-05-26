import { Effect, Layer } from "effect";
import { Embedder } from "../../embedding/Embedder";
import { VectorStoreError } from "../../lib/errors/VectorStoreError";
import { VectorStoreSchemaError } from "../../lib/errors/VectorStoreSchemaError";
import { VectorStore } from "../VectorStore";
import { openVectorStore } from "../openVectorStore";

interface Params {
  readonly sqlitePath: string;
  readonly vacuumOnBoot: boolean;
}

/**
 * Build the Layer providing the `VectorStore` tag. Reads the model
 * identity from the resolved `Embedder` (already in the layer graph
 * by the time this runs), opens the on-disk SQLite file, applies the
 * schema, verifies the taintedness metadata, and exposes the prepared-
 * statement-backed impl.
 *
 * The dependency on `Embedder` is intentional: the store doesn't have
 * a sane default for its own dimensionality — it has to match whatever
 * the embedder produces. This wiring guarantees they never drift.
 *
 * @param params Resolved `vectorStoreConfig`.
 * @returns      Layer providing VectorStore, requires Embedder.
 */
export const VectorStoreLayer = (params: Params) =>
  Layer.effect(
    VectorStore,
    Effect.gen(function* () {
      const embedder = yield* Embedder;
      const impl = yield* openVectorStore(
        params.sqlitePath,
        {
          model: embedder.modelName,
          version: embedder.modelVersion,
          dim: embedder.dimensions,
        },
        params.vacuumOnBoot,
      );
      return impl;
    }),
  ) satisfies Layer.Layer<VectorStore, VectorStoreError | VectorStoreSchemaError, Embedder>;
