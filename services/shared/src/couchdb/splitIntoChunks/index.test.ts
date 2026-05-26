import { describe, expect, it } from "vitest";
import { splitIntoChunks } from "./index.ts";

describe("splitIntoChunks", () => {
  it("returns a single chunk when the body fits in one", () => {
    expect(splitIntoChunks("hello", 100)).toEqual(["hello"]);
  });

  it("splits longer bodies into chunks of the requested size", () => {
    const body = "a".repeat(25);
    expect(splitIntoChunks(body, 10)).toEqual(["aaaaaaaaaa", "aaaaaaaaaa", "aaaaa"]);
  });

  it("round-trips with simple concat", () => {
    const body = "the quick brown fox jumps over the lazy dog";
    const chunks = splitIntoChunks(body, 7);
    expect(chunks.join("")).toBe(body);
  });

  it("handles the empty body", () => {
    expect(splitIntoChunks("", 100)).toEqual([""]);
  });
});
