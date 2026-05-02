import { describe, expect, it } from "vitest";
import { NoteNotFoundError } from "./index.ts";

describe("NoteNotFoundError", () => {
  it("carries the tag and path", () => {
    const err = new NoteNotFoundError({ path: "Daily/2026-05-02.md" });
    expect(err._tag).toBe("NoteNotFoundError");
    expect(err.path).toBe("Daily/2026-05-02.md");
  });
});
