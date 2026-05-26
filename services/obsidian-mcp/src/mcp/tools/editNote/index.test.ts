import { Vault, type VaultImpl } from "@niranjan/vault-shared/couchdb";
import { Effect, Layer, ManagedRuntime } from "effect";
import { describe, expect, it, vi } from "vitest";
import { editNote } from "./index.ts";

const buildStub = (
  editImpl: VaultImpl["editNote"],
): { runtime: Awaited<ReturnType<typeof inner>>; stub: VaultImpl } => {
  const stub: VaultImpl = {
    listNotes: () => Effect.succeed([]),
    listRecent: () => Effect.succeed([]),
    readNote: () => Effect.succeed({} as never),
    readNoteById: () => Effect.fail(new Error("stub")) as never,
    readAllForIndex: () => Effect.succeed([]),
    createNote: () => Effect.succeed({} as never),
    updateNote: () => Effect.succeed({} as never),
    appendToNote: () => Effect.succeed({} as never),
    editNote: editImpl,
    deleteNote: () => Effect.void,
  };
  return { stub } as never;
};

const inner = async (stub: VaultImpl) => {
  const runtime = ManagedRuntime.make(Layer.succeed(Vault, stub));
  return runtime.runtime();
};

describe("edit_note tool", () => {
  it("forwards path / old_string / new_string / replace_all to Vault.editNote", async () => {
    const editSpy = vi.fn((path: string, _old: string, _new: string, _replaceAll: boolean) =>
      Effect.succeed({
        path,
        _rev: "2-x",
        frontmatter: {},
        body: "after",
        mtime: 2,
        ctime: 1,
        size: 5,
      }),
    );
    const { stub } = buildStub(editSpy as never);
    const result = await editNote((await inner(stub)) as never).handler({
      path: "notes/foo.md",
      old_string: "before",
      new_string: "after",
      replace_all: true,
    });
    expect(result.isError).toBeUndefined();
    expect(editSpy).toHaveBeenCalledWith("notes/foo.md", "before", "after", true);
  });

  it("defaults replace_all to false when omitted", async () => {
    const editSpy = vi.fn((path: string) =>
      Effect.succeed({
        path,
        _rev: "2-x",
        frontmatter: {},
        body: "",
        mtime: 2,
        ctime: 1,
        size: 0,
      }),
    );
    const { stub } = buildStub(editSpy as never);
    await editNote((await inner(stub)) as never).handler({
      path: "notes/foo.md",
      old_string: "x",
      new_string: "y",
    });
    expect(editSpy).toHaveBeenCalledWith("notes/foo.md", "x", "y", false);
  });
});
