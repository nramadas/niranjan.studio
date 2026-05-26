import { Config } from "effect";

/**
 * Typed config for the embedding backend. `kind` picks which `Embedder`
 * implementation gets wired into the runtime; `openaiApiKey` is required
 * iff the OpenAI implementations are selected.
 *
 * `modelDir` is where the baked-in bge-small ONNX + tokeniser files live
 * inside the container — set by the Dockerfile, override only when running
 * outside the official image. The default matches the path the model-fetch
 * stage writes to.
 */
export const embedderConfig = Config.all({
  kind: Config.literal(
    "bge-small",
    "openai-small",
    "openai-large",
  )("EMBEDDER").pipe(Config.withDefault("bge-small" as const)),
  modelDir: Config.string("MODEL_DIR").pipe(Config.withDefault("/opt/vault-indexer/model")),
  openaiApiKey: Config.redacted("OPENAI_API_KEY").pipe(Config.option),
});
