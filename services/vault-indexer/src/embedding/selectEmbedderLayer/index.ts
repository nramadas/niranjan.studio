import { Effect, Layer, Option, Redacted } from "effect";
import { EmbeddingError } from "../../lib/errors/EmbeddingError";
import { BgeSmallEmbedderLayer } from "../BgeSmallEmbedderLayer";
import { Embedder } from "../Embedder";
import { OpenAIEmbedderLayer } from "../OpenAIEmbedderLayer";

interface Params {
  readonly kind: "bge-small" | "openai-small" | "openai-large";
  readonly modelDir: string;
  readonly openaiApiKey: Option.Option<Redacted.Redacted<string>>;
}

/**
 * Pick the concrete `Embedder` layer based on the `EMBEDDER` config
 * value. Centralising this here means the rest of the runtime composes
 * a single layer (`Embedder`) and never sees which backend is wired in —
 * the same property that lets the evaluation harness swap models per
 * run.
 *
 * For OpenAI implementations, an API key is required: a missing key
 * surfaces at boot as an `EmbeddingError` through `Layer.fail` rather
 * than starting the indexer and 500-ing on the first embed call.
 *
 * @param params The kind selector, model directory (bge), and optional OpenAI key.
 * @returns      A Layer providing the Embedder tag, or one that fails at boot.
 */
export const selectEmbedderLayer = (params: Params) => {
  switch (params.kind) {
    case "bge-small":
      return BgeSmallEmbedderLayer(params.modelDir);
    case "openai-small":
      return withApiKey(params.openaiApiKey, "text-embedding-3-small", 384);
    case "openai-large":
      return withApiKey(params.openaiApiKey, "text-embedding-3-large", 384);
  }
};

const withApiKey = (
  key: Option.Option<Redacted.Redacted<string>>,
  modelName: "text-embedding-3-small" | "text-embedding-3-large",
  dimensions: number,
) =>
  Option.match(key, {
    onNone: () =>
      Layer.effectDiscard(
        Effect.fail(
          new EmbeddingError({
            model: modelName,
            message: `EMBEDDER=${modelName} requires OPENAI_API_KEY to be set`,
          }),
        ),
      ).pipe(Layer.provide(Layer.empty)) as ReturnType<typeof OpenAIEmbedderLayer>,
    onSome: (apiKey) => OpenAIEmbedderLayer({ modelName, dimensions, apiKey }),
  });

// Marker re-export so consumers' barrels see the Embedder tag transitively.
export { Embedder };
