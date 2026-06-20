import { describe, expect, it } from "vitest";
import { validateBearer } from "./index.ts";

describe("validateBearer", () => {
  it("accepts the exact expected token", () => {
    expect(validateBearer("Bearer secret-token", "secret-token")).toBe(true);
  });

  it("is case-insensitive on the scheme", () => {
    expect(validateBearer("bearer secret-token", "secret-token")).toBe(true);
  });

  it("rejects a wrong token of equal length", () => {
    expect(validateBearer("Bearer secret-tokeX", "secret-token")).toBe(false);
  });

  it("rejects a missing header", () => {
    expect(validateBearer(undefined, "secret-token")).toBe(false);
  });

  it("rejects a header without the Bearer scheme", () => {
    expect(validateBearer("Token secret-token", "secret-token")).toBe(false);
  });

  it("rejects a length-mismatched token without throwing", () => {
    expect(validateBearer("Bearer short", "a-much-longer-secret-token")).toBe(false);
  });
});
