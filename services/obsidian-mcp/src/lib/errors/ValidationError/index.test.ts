import { describe, expect, it } from "vitest";
import { ValidationError } from "./index.ts";

describe("ValidationError", () => {
  it("carries the tag, field, and message", () => {
    const err = new ValidationError({ field: "path", message: "must be non-empty" });
    expect(err._tag).toBe("ValidationError");
    expect(err.field).toBe("path");
  });
});
