import { Vault, type VaultImpl } from "@niranjan/vault-shared/couchdb";
import { NoteNotFoundError } from "@niranjan/vault-shared/lib/errors";
import { Effect, Layer, ManagedRuntime } from "effect";
import { describe, expect, it } from "vitest";
import { readNote } from "./index.ts";

const stubVault: VaultImpl = {
  listNotes: () => Effect.succeed([]),
  listRecent: () => Effect.succeed([]),
  readNote: (path) =>
    path === "Notes/x.md"
      ? Effect.succeed({
          path,
          _rev: "1-x",
          frontmatter: { tag: "test" },
          body: "hello",
          mtime: 1,
          ctime: 1,
          size: 5,
        })
      : Effect.fail(new NoteNotFoundError({ path })),
  readNoteById: () => Effect.fail(new Error("stub")) as never,
  readAllForIndex: () => Effect.succeed([]),
  createNote: () => Effect.succeed({} as never),
  updateNote: () => Effect.succeed({} as never),
  appendToNote: () => Effect.succeed({} as never),
  editNote: () => Effect.succeed({} as never),
  deleteNote: () => Effect.void,
};

describe("readNote tool", () => {
  it("returns the note when present", async () => {
    const runtime = ManagedRuntime.make(Layer.succeed(Vault, stubVault));
    const inner = await runtime.runtime();
    const result = await readNote(inner as never).handler({ path: "Notes/x.md" });
    expect(result.isError).toBeUndefined();
    expect((result.structuredContent as { body: string }).body).toBe("hello");
  });

  it("returns an isError result for a missing note", async () => {
    const runtime = ManagedRuntime.make(Layer.succeed(Vault, stubVault));
    const inner = await runtime.runtime();
    const result = await readNote(inner as never).handler({ path: "missing.md" });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("NoteNotFoundError");
  });
});
