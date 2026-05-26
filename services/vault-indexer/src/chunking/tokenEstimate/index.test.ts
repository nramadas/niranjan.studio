import { describe, expect, it } from "vitest";
import { tokenEstimate } from "./index.ts";

describe("tokenEstimate", () => {
  it("returns 0 for empty string", () => {
    expect(tokenEstimate("")).toBe(0);
  });
  it("rounds up", () => {
    expect(tokenEstimate("abc")).toBe(1); // 3/4 → 1
    expect(tokenEstimate("abcd")).toBe(1); // 4/4 → 1
    expect(tokenEstimate("abcde")).toBe(2); // 5/4 → 2
  });
  it("scales linearly with length", () => {
    expect(tokenEstimate("a".repeat(400))).toBe(100);
    expect(tokenEstimate("a".repeat(800))).toBe(200);
  });
});
