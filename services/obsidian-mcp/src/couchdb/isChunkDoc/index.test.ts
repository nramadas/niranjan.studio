import { describe, expect, it } from "vitest";
import { isChunkDoc } from "./index.ts";

describe("isChunkDoc", () => {
  it("returns true only for the leaf type", () => {
    expect(isChunkDoc({ type: "leaf" })).toBe(true);
  });

  it("returns false for note types and unknown types", () => {
    expect(isChunkDoc({ type: "newnote" })).toBe(false);
    expect(isChunkDoc({ type: "plain" })).toBe(false);
    expect(isChunkDoc({})).toBe(false);
  });
});
