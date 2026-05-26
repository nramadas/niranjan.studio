import { describe, expect, it } from "vitest";
import { l2Normalise } from "./index.ts";

describe("l2Normalise", () => {
  it("returns a unit-length vector", () => {
    const out = l2Normalise([3, 4]);
    expect(out).toHaveLength(2);
    const mag = Math.sqrt((out[0] ?? 0) ** 2 + (out[1] ?? 0) ** 2);
    expect(mag).toBeCloseTo(1, 10);
  });

  it("preserves direction", () => {
    const out = l2Normalise([3, 4]);
    expect(out[0]).toBeCloseTo(3 / 5, 10);
    expect(out[1]).toBeCloseTo(4 / 5, 10);
  });

  it("leaves the zero vector unchanged", () => {
    expect(l2Normalise([0, 0, 0])).toEqual([0, 0, 0]);
  });

  it("handles negative components", () => {
    const out = l2Normalise([-1, 0, 0]);
    expect(out[0]).toBeCloseTo(-1, 10);
  });

  it("does not mutate the input", () => {
    const input = [1, 2, 3];
    const snapshot = [...input];
    l2Normalise(input);
    expect(input).toEqual(snapshot);
  });
});
