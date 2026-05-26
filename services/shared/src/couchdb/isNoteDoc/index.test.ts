import { describe, expect, it } from "vitest";
import { isNoteDoc } from "./index.ts";

describe("isNoteDoc", () => {
  it("returns true for newnote and plain types", () => {
    expect(isNoteDoc({ type: "newnote" })).toBe(true);
    expect(isNoteDoc({ type: "plain" })).toBe(true);
  });

  it("returns false for chunks and unknown types", () => {
    expect(isNoteDoc({ type: "leaf" })).toBe(false);
    expect(isNoteDoc({ type: "chunkpack" })).toBe(false);
    expect(isNoteDoc({})).toBe(false);
  });
});
