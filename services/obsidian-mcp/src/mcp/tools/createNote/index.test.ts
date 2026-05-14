import { describe, expect, it } from "vitest";
import { Effect, Layer, ManagedRuntime } from "effect";
import { createNote } from "./index.ts";
import { Vault, type VaultImpl } from "../../../couchdb/Vault";
import { NoteConflictError } from "../../../lib/errors/NoteConflictError";

const stubVault: VaultImpl = {
  listNotes: () => Effect.succeed([]),
  listRecent: () => Effect.succeed([]),
  readNote: () => Effect.succeed({} as never),
  readAllForIndex: () => Effect.succeed([]),
  createNote: (path, body) =>
    path.startsWith("Existing")
      ? Effect.fail(new NoteConflictError({ path, message: "exists" }))
      : Effect.succeed({
          path,
          _rev: "1-x",
          frontmatter: {},
          body,
          mtime: 1,
          ctime: 1,
          size: body.length,
        }),
  updateNote: () => Effect.succeed({} as never),
  appendToNote: () => Effect.succeed({} as never),
      editNote: () => Effect.succeed({} as never),
  deleteNote: () => Effect.void,
};

describe("createNote tool", () => {
  it("creates a new note", async () => {
    const runtime = ManagedRuntime.make(Layer.succeed(Vault, stubVault));
    const inner = await runtime.runtime();
    const result = await createNote(inner as never).handler({
      path: "Notes/new.md",
      body: "hello",
    });
    expect(result.isError).toBeUndefined();
    const body = (result.structuredContent as { body: string }).body;
    expect(body).toBe("hello");
  });

  it("surfaces NoteConflictError when the path already exists", async () => {
    const runtime = ManagedRuntime.make(Layer.succeed(Vault, stubVault));
    const inner = await runtime.runtime();
    const result = await createNote(inner as never).handler({
      path: "Existing/note.md",
      body: "x",
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("NoteConflictError");
  });
});
