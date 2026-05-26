import { Effect, Layer } from "effect";
import { EmbeddingError } from "../../lib/errors/EmbeddingError";
import { Embedder, type EmbedderImpl } from "../Embedder";
import { l2Normalise } from "../l2Normalise";
import type { EmbeddingVector } from "../types.ts";

const MODEL_NAME = "bge-small-en-v1.5" as const;
const MODEL_VERSION = "Xenova/bge-small-en-v1.5@quantized" as const;
const DIMENSIONS = 384 as const;

/**
 * Default in-process embedder. Loads BAAI/bge-small-en-v1.5 (the Xenova
 * ONNX repackaging) via `@huggingface/transformers` at construction time,
 * pulling weights from the local `modelDir` rather than the network. The
 * Dockerfile bakes those files in at build time so the indexer comes up
 * with no outbound traffic.
 *
 * The pipeline returns mean-pooled embeddings already; we run them
 * through `l2Normalise` so the storage layer's L2 distance is
 * cosine-equivalent (the contract every Embedder upholds).
 *
 * @param modelDir Absolute path of the directory holding the bge-small
 *                 ONNX + tokeniser files. The transformers.js loader
 *                 reads from `${modelDir}/Xenova/bge-small-en-v1.5/...`.
 *                 Set `env.localModelPath` and `env.allowRemoteModels =
 *                 false` so a missing file fails loud rather than
 *                 silently fetching at first call.
 * @returns        A Layer providing the Embedder tag, ready to be
 *                 merged into the app layer.
 */
export const BgeSmallEmbedderLayer = (modelDir: string) =>
  Layer.effect(
    Embedder,
    Effect.gen(function* () {
      const transformers = yield* Effect.tryPromise({
        try: () => import("@huggingface/transformers"),
        catch: (cause) =>
          new EmbeddingError({
            model: MODEL_NAME,
            message: `failed to import @huggingface/transformers: ${
              cause instanceof Error ? cause.message : String(cause)
            }`,
            cause,
          }),
      });

      // Pin local mode before constructing the pipeline. `env` is a
      // mutable singleton on the transformers module.
      const env = (transformers as unknown as { env: Record<string, unknown> }).env;
      env.localModelPath = modelDir;
      env.allowLocalModels = true;
      env.allowRemoteModels = false;

      type FeaturePipeline = (
        texts: string | string[],
        options?: {
          pooling?: string;
          normalize?: boolean;
          truncation?: boolean;
          max_length?: number;
        },
      ) => Promise<{ data: Float32Array; dims: number[] }>;

      // bge-small's positional embeddings cap at 512 tokens. Our chunker
      // sizes by character estimate (~4 chars/token), which holds for
      // prose but underestimates by 1.5-2x on dense code (every punct
      // token gets its own slot). Without explicit truncation,
      // transformers.js can pass an overlong sequence into the ONNX
      // runtime, where the C++ runtime's behaviour on out-of-range inputs
      // ranges from a thrown error to a segfault (kills the container
      // with no log). truncation + max_length give us a hard contract.
      const MODEL_MAX_TOKENS = 512;

      const featureExtractor = yield* Effect.tryPromise({
        try: () =>
          (
            transformers as unknown as {
              pipeline: (task: string, model: string, opts?: unknown) => Promise<FeaturePipeline>;
            }
          ).pipeline("feature-extraction", "Xenova/bge-small-en-v1.5", {
            quantized: true,
          }),
        catch: (cause) =>
          new EmbeddingError({
            model: MODEL_NAME,
            message: `failed to load bge-small pipeline from ${modelDir}: ${
              cause instanceof Error ? cause.message : String(cause)
            }`,
            cause,
          }),
      });

      yield* Effect.logInfo(`bge-small embedder ready (dim=${DIMENSIONS}, modelDir=${modelDir})`);

      // Batch size for ONNX inference. Peak memory during inference
      // scales roughly linearly with batch_size × max_seq_len, so a big
      // batch (e.g. all 50 chunks of a long note at once) can push Node
      // past its heap or trigger an OOM kill on a small VM. 8 keeps the
      // working set bounded while still amortising tokenisation /
      // graph-setup cost across multiple chunks.
      const EMBED_BATCH_SIZE = 8;

      const embedBatch = (
        texts: ReadonlyArray<string>,
      ): Effect.Effect<ReadonlyArray<EmbeddingVector>, EmbeddingError> =>
        Effect.gen(function* () {
          if (texts.length === 0) return [] as ReadonlyArray<EmbeddingVector>;
          const tensor = yield* Effect.tryPromise({
            try: () =>
              featureExtractor(texts as string[], {
                pooling: "mean",
                normalize: false,
                truncation: true,
                max_length: MODEL_MAX_TOKENS,
              }),
            catch: (cause) =>
              new EmbeddingError({
                model: MODEL_NAME,
                message: `bge-small inference failed: ${
                  cause instanceof Error ? cause.message : String(cause)
                }`,
                cause,
              }),
          });

          // The tensor's `data` is a flat Float32Array of shape [N, dim].
          // We slice it into N vectors of length `dim`, normalise each,
          // and return. Trust the model's dim claim, but assert against
          // our constant — a mismatch here would mean the model files in
          // the image are not what the schema expects, which is a build
          // bug worth failing loud on.
          if (tensor.dims.length !== 2 || tensor.dims[1] !== DIMENSIONS) {
            return yield* Effect.fail(
              new EmbeddingError({
                model: MODEL_NAME,
                message: `bge-small returned tensor shape ${JSON.stringify(
                  tensor.dims,
                )} but expected [N, ${DIMENSIONS}]`,
              }),
            );
          }
          const out: EmbeddingVector[] = [];
          for (let i = 0; i < texts.length; i++) {
            const raw = Array.from(tensor.data.slice(i * DIMENSIONS, (i + 1) * DIMENSIONS));
            out.push(l2Normalise(raw));
          }
          return out;
        });

      const embed = (
        texts: ReadonlyArray<string>,
      ): Effect.Effect<ReadonlyArray<EmbeddingVector>, EmbeddingError> =>
        Effect.gen(function* () {
          if (texts.length === 0) return [] as ReadonlyArray<EmbeddingVector>;
          const out: EmbeddingVector[] = [];
          for (let i = 0; i < texts.length; i += EMBED_BATCH_SIZE) {
            const batch = texts.slice(i, i + EMBED_BATCH_SIZE);
            const vectors = yield* embedBatch(batch);
            for (const v of vectors) out.push(v);
          }
          return out;
        });

      return {
        modelName: MODEL_NAME,
        modelVersion: MODEL_VERSION,
        dimensions: DIMENSIONS,
        embed,
      } satisfies EmbedderImpl;
    }),
  );
