import { Effect, Layer, Redacted } from "effect";
import { EmbeddingError } from "../../lib/errors/EmbeddingError";
import { Embedder, type EmbedderImpl } from "../Embedder";
import { l2Normalise } from "../l2Normalise";
import type { EmbeddingVector } from "../types.ts";

interface OpenAIEmbeddingResponse {
  readonly data: ReadonlyArray<{
    readonly embedding: ReadonlyArray<number>;
    readonly index: number;
  }>;
  readonly model: string;
  readonly usage?: { readonly prompt_tokens: number; readonly total_tokens: number };
}

interface Params {
  readonly modelName: "text-embedding-3-small" | "text-embedding-3-large";
  readonly dimensions: number;
  readonly apiKey: Redacted.Redacted<string>;
}

/**
 * Generic OpenAI embedder factory shared by the two concrete layers
 * (`OpenAISmallEmbedderLayer` and `OpenAILargeEmbedderLayer`). Posts to
 * `https://api.openai.com/v1/embeddings` with the chosen model name and
 * the requested `dimensions` (OpenAI supports per-request truncation —
 * we exploit it so the storage schema's dimension is constant across
 * model swaps).
 *
 * OpenAI returns vectors that are already L2-normalised by the API in
 * v3, but we re-normalise defensively because (a) the API has been
 * known to drift and (b) truncating dimensions can change magnitude.
 *
 * Used in production only when `EMBEDDER=openai-*` is set, primarily
 * by the evaluation harness — the default deployment uses bge-small.
 *
 * @param params Model + dimensions + redacted key.
 * @returns      A Layer providing the Embedder tag.
 */
export const OpenAIEmbedderLayer = (params: Params) => Layer.succeed(Embedder, buildImpl(params));

const buildImpl = (params: Params): EmbedderImpl => ({
  modelName: params.modelName,
  modelVersion: `openai/${params.modelName}@v3`,
  dimensions: params.dimensions,
  embed: (texts) => embedBatch(params, texts),
});

const embedBatch = (
  params: Params,
  texts: ReadonlyArray<string>,
): Effect.Effect<ReadonlyArray<EmbeddingVector>, EmbeddingError> =>
  Effect.gen(function* () {
    if (texts.length === 0) return [] as ReadonlyArray<EmbeddingVector>;

    const body = JSON.stringify({
      model: params.modelName,
      input: texts,
      dimensions: params.dimensions,
      encoding_format: "float",
    });

    const res = yield* Effect.tryPromise({
      try: () =>
        fetch("https://api.openai.com/v1/embeddings", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${Redacted.value(params.apiKey)}`,
          },
          body,
        }),
      catch: (cause) =>
        new EmbeddingError({
          model: params.modelName,
          message: `OpenAI embeddings fetch failed: ${
            cause instanceof Error ? cause.message : String(cause)
          }`,
          cause,
        }),
    });

    if (!res.ok) {
      const text = yield* Effect.promise(() => res.text().catch(() => ""));
      return yield* Effect.fail(
        new EmbeddingError({
          model: params.modelName,
          status: res.status,
          message: `OpenAI embeddings returned ${res.status}: ${text.slice(0, 500)}`,
        }),
      );
    }

    const json = (yield* Effect.tryPromise({
      try: () => res.json(),
      catch: (cause) =>
        new EmbeddingError({
          model: params.modelName,
          message: `OpenAI embeddings response was not valid JSON: ${
            cause instanceof Error ? cause.message : String(cause)
          }`,
          cause,
        }),
    })) as OpenAIEmbeddingResponse;

    if (!Array.isArray(json.data) || json.data.length !== texts.length) {
      return yield* Effect.fail(
        new EmbeddingError({
          model: params.modelName,
          message: `OpenAI returned ${
            json.data?.length ?? 0
          } embeddings for ${texts.length} inputs`,
        }),
      );
    }

    const out: EmbeddingVector[] = new Array(texts.length);
    for (const entry of json.data) {
      if (entry.embedding.length !== params.dimensions) {
        return yield* Effect.fail(
          new EmbeddingError({
            model: params.modelName,
            message: `OpenAI returned embedding of length ${entry.embedding.length} expected ${params.dimensions}`,
          }),
        );
      }
      out[entry.index] = l2Normalise(entry.embedding);
    }
    return out;
  });
