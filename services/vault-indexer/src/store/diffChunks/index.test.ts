import { describe, expect, it } from "vitest";
import { diffChunks } from "./index.ts";

const hashOf = (c: { hash: string }) => c.hash;

describe("diffChunks", () => {
  it("treats all incoming chunks as new when the store is empty", () => {
    const result = diffChunks(
      { priorRefs: [], incomingChunks: [{ hash: "a" }, { hash: "b" }] },
      hashOf,
    );
    expect(result.toEmbed.map(hashOf)).toEqual(["a", "b"]);
    expect(result.toDeleteRowids).toEqual([]);
    expect(result.unchangedRowids).toEqual([]);
  });

  it("treats all prior chunks as stale when the incoming set is empty", () => {
    const result = diffChunks(
      {
        priorRefs: [
          { hash: "a", rowid: 1 },
          { hash: "b", rowid: 2 },
        ],
        incomingChunks: [],
      },
      hashOf,
    );
    expect(result.toEmbed).toEqual([]);
    expect([...result.toDeleteRowids].sort()).toEqual([1, 2]);
    expect(result.unchangedRowids).toEqual([]);
  });

  it("identifies unchanged, new, and stale partitions for a partial edit", () => {
    const result = diffChunks(
      {
        priorRefs: [
          { hash: "a", rowid: 1 },
          { hash: "b", rowid: 2 },
          { hash: "c", rowid: 3 },
        ],
        incomingChunks: [{ hash: "a" }, { hash: "b" }, { hash: "d" }],
      },
      hashOf,
    );
    expect(result.toEmbed.map(hashOf)).toEqual(["d"]);
    expect(result.toDeleteRowids).toEqual([3]);
    expect([...result.unchangedRowids].sort()).toEqual([1, 2]);
  });

  it("treats a full content swap as full re-embed + full delete", () => {
    const result = diffChunks(
      {
        priorRefs: [
          { hash: "a", rowid: 10 },
          { hash: "b", rowid: 20 },
        ],
        incomingChunks: [{ hash: "x" }, { hash: "y" }],
      },
      hashOf,
    );
    expect([...result.toEmbed.map(hashOf)].sort()).toEqual(["x", "y"]);
    expect([...result.toDeleteRowids].sort()).toEqual([10, 20]);
    expect(result.unchangedRowids).toEqual([]);
  });

  it("does not duplicate incoming hashes already present in prior", () => {
    const result = diffChunks(
      {
        priorRefs: [{ hash: "a", rowid: 5 }],
        incomingChunks: [{ hash: "a" }, { hash: "a" }],
      },
      hashOf,
    );
    expect(result.toEmbed).toEqual([]);
    expect(result.unchangedRowids).toEqual([5]);
  });
});
