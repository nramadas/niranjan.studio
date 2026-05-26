import { describe, expect, it } from "vitest";
import { sha256Hash } from "./index.ts";

describe("sha256Hash", () => {
  it("returns 16 lowercase hex characters", () => {
    const h = sha256Hash("hello world");
    expect(h).toMatch(/^[0-9a-f]{16}$/);
  });
  it("is deterministic", () => {
    expect(sha256Hash("abc")).toBe(sha256Hash("abc"));
  });
  it("differs by one bit on different inputs", () => {
    expect(sha256Hash("abc")).not.toBe(sha256Hash("abd"));
  });
  it("handles unicode", () => {
    expect(sha256Hash("naïve")).toMatch(/^[0-9a-f]{16}$/);
  });
});
