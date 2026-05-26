import { describe, expect, it } from "vitest";
import { NoteConflictError } from "./index.ts";

describe("NoteConflictError", () => {
  it("carries the tag, path, and message", () => {
    const err = new NoteConflictError({ path: "Daily/note.md", message: "lost rev race" });
    expect(err._tag).toBe("NoteConflictError");
    expect(err.path).toBe("Daily/note.md");
    expect(err.message).toBe("lost rev race");
  });
});
