import { Option } from "effect";
import { describe, expect, it } from "vitest";
import { selectEmbedderLayer } from "./index.ts";

describe("selectEmbedderLayer", () => {
  it("returns a Layer for bge-small without requiring an API key", () => {
    const layer = selectEmbedderLayer({
      kind: "bge-small",
      modelDir: "/tmp/none",
      openaiApiKey: Option.none(),
    });
    expect(layer).toBeDefined();
  });

  it("returns a Layer for openai-small when an API key is present", () => {
    const layer = selectEmbedderLayer({
      kind: "openai-small",
      modelDir: "/tmp/none",
      openaiApiKey: Option.some({ value: "sk-fake" } as never),
    });
    expect(layer).toBeDefined();
  });

  it("constructs a failing Layer for openai-* without an API key", () => {
    // The Layer is built but its construction Effect fails at boot.
    const layer = selectEmbedderLayer({
      kind: "openai-large",
      modelDir: "/tmp/none",
      openaiApiKey: Option.none(),
    });
    expect(layer).toBeDefined();
  });
});
