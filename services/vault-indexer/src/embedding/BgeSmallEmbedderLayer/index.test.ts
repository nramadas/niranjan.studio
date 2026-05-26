import { describe, expect, it } from "vitest";
import { BgeSmallEmbedderLayer } from "./index.ts";

describe("BgeSmallEmbedderLayer", () => {
  // The bge-small ONNX model is too heavy to load in unit tests (200+ MB
  // resident, several seconds of cold start). This test exists to assert
  // the Layer is constructible and exposes the public surface; behavioural
  // verification happens via the eval harness against the real model.
  it("is a function that returns a Layer", () => {
    const layer = BgeSmallEmbedderLayer("/tmp/nowhere");
    expect(layer).toBeDefined();
    expect(typeof layer).toBe("object");
  });
});
