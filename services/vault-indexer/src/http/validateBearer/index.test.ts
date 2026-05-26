import { describe, expect, it } from "vitest";
import { validateBearer } from "./index.ts";

describe("validateBearer", () => {
  it("returns true on matching token", () => {
    expect(validateBearer("Bearer abc123", "abc123")).toBe(true);
  });

  it("is case-insensitive on the 'Bearer' prefix", () => {
    expect(validateBearer("bearer abc123", "abc123")).toBe(true);
    expect(validateBearer("BEARER abc123", "abc123")).toBe(true);
  });

  it("returns false on missing header", () => {
    expect(validateBearer(undefined, "abc123")).toBe(false);
  });

  it("returns false on missing 'Bearer ' prefix", () => {
    expect(validateBearer("abc123", "abc123")).toBe(false);
  });

  it("returns false on token mismatch", () => {
    expect(validateBearer("Bearer wrong", "right")).toBe(false);
  });

  it("returns false on length-mismatched token", () => {
    expect(validateBearer("Bearer abc", "abcdef")).toBe(false);
  });
});
