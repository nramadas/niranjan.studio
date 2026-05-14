import { describe, expect, it } from "vitest";
import { StringMatchError } from "./index.ts";

describe("StringMatchError", () => {
  it("carries the tagged discriminator and structured fields", () => {
    const err = new StringMatchError({
      path: "notes/foo.md",
      reason: "not_found",
      occurrences: 0,
    });
    expect(err._tag).toBe("StringMatchError");
    expect(err.path).toBe("notes/foo.md");
    expect(err.reason).toBe("not_found");
    expect(err.occurrences).toBe(0);
  });

  it("distinguishes ambiguous from not_found via reason", () => {
    const ambiguous = new StringMatchError({
      path: "x.md",
      reason: "ambiguous",
      occurrences: 3,
    });
    expect(ambiguous.reason).toBe("ambiguous");
    expect(ambiguous.occurrences).toBe(3);
  });
});
