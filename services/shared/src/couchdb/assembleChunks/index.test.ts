import { describe, expect, it } from "vitest";
import { assembleChunks } from "./index.ts";

describe("assembleChunks", () => {
  it("concatenates chunks in order", () => {
    expect(assembleChunks(["foo", "bar", "baz"])).toBe("foobarbaz");
  });

  it("returns the empty string for no chunks", () => {
    expect(assembleChunks([])).toBe("");
  });

  it("preserves whitespace at chunk boundaries", () => {
    expect(assembleChunks(["a ", " b"])).toBe("a  b");
  });
});
