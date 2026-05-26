import { Vault, type VaultImpl } from "@niranjan/vault-shared/couchdb";
import { Effect, Layer, ManagedRuntime } from "effect";
import { describe, expect, it, vi } from "vitest";
import { appendToNote } from "./index.ts";

describe("appendToNote tool", () => {
  it("invokes Vault.appendToNote with the supplied content", async () => {
    const appendSpy = vi.fn((path: string, content: string) =>
      Effect.succeed({
        path,
        _rev: "2-x",
        frontmatter: {},
        body: `existing\n${content}`,
        mtime: 2,
        ctime: 1,
        size: content.length + 9,
      }),
    );
    const stub: VaultImpl = {
      listNotes: () => Effect.succeed([]),
      listRecent: () => Effect.succeed([]),
      readNote: () => Effect.succeed({} as never),
      readNoteById: () => Effect.fail(new Error("stub")) as never,
      readAllForIndex: () => Effect.succeed([]),
      createNote: () => Effect.succeed({} as never),
      updateNote: () => Effect.succeed({} as never),
      appendToNote: appendSpy as never,
      editNote: () => Effect.succeed({} as never),
      deleteNote: () => Effect.void,
    };
    const runtime = ManagedRuntime.make(Layer.succeed(Vault, stub));
    const inner = await runtime.runtime();
    const result = await appendToNote(inner as never).handler({
      path: "Daily/today.md",
      content: "- new item",
    });
    expect(result.isError).toBeUndefined();
    expect(appendSpy).toHaveBeenCalledWith("Daily/today.md", "- new item");
  });
});
