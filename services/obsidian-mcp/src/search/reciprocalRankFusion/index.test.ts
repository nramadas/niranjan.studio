import { describe, expect, it } from "vitest";
import { reciprocalRankFusion } from "./index.ts";

describe("reciprocalRankFusion", () => {
  const make = (ids: string[]) => ids.map((id) => ({ id, value: { tag: id } }));

  it("returns empty for empty input", () => {
    expect(reciprocalRankFusion([])).toEqual([]);
  });

  it("ranks a single list identically to its input order", () => {
    const fused = reciprocalRankFusion([make(["a", "b", "c"])]);
    expect(fused.map((f) => f.id)).toEqual(["a", "b", "c"]);
  });

  it("boosts items appearing in multiple lists", () => {
    const fused = reciprocalRankFusion([make(["a", "b", "c"]), make(["b", "d", "a"])]);
    // `a` is in both (rank 1 + rank 3); `b` is in both (rank 2 + rank 1);
    // `b` should sit at or near the top; `a` close behind; `c` and `d` later.
    expect(fused[0]?.id).toBe("b");
    expect(new Set(fused.slice(0, 2).map((f) => f.id))).toEqual(new Set(["a", "b"]));
  });

  it("handles items present in only one list", () => {
    const fused = reciprocalRankFusion([make(["a"]), make(["b"])]);
    expect(fused).toHaveLength(2);
  });

  it("first list wins the value field on duplicates", () => {
    const fused = reciprocalRankFusion([
      [{ id: "a", value: "from-first" }],
      [{ id: "a", value: "from-second" }],
    ]);
    expect(fused).toHaveLength(1);
    expect(fused[0]?.value).toBe("from-first");
  });

  it("k=60 default produces stable, comparable contributions across small lists", () => {
    const fused = reciprocalRankFusion([make(["a", "b"]), make(["a", "b"])]);
    // Both items appear at rank 1 and rank 2 in both lists, so:
    //   a = 2/(60+1) ≈ 0.03279
    //   b = 2/(60+2) ≈ 0.03226
    // Both are non-zero and a > b.
    expect(fused[0]?.id).toBe("a");
    expect(fused[1]?.id).toBe("b");
    expect((fused[0]?.score ?? 0) > (fused[1]?.score ?? 0)).toBe(true);
  });

  it("respects a custom k value", () => {
    const small = reciprocalRankFusion([make(["a", "b"])], 1);
    const big = reciprocalRankFusion([make(["a", "b"])], 1000);
    // Score gap between rank-1 and rank-2 shrinks as k grows.
    const smallGap = (small[0]?.score ?? 0) - (small[1]?.score ?? 0);
    const bigGap = (big[0]?.score ?? 0) - (big[1]?.score ?? 0);
    expect(smallGap).toBeGreaterThan(bigGap);
  });
});
