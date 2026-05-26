import { Vault, type VaultImpl } from "@niranjan/vault-shared/couchdb";
import { Effect, Layer, ManagedRuntime } from "effect";
import { describe, expect, it, vi } from "vitest";
import { deleteNote } from "./index.ts";

describe("deleteNote tool", () => {
  it("invokes Vault.deleteNote and returns ok+path", async () => {
    const deleteSpy = vi.fn(() => Effect.void);
    const stub: VaultImpl = {
      listNotes: () => Effect.succeed([]),
      listRecent: () => Effect.succeed([]),
      readNote: () => Effect.succeed({} as never),
      readNoteById: () => Effect.fail(new Error("stub")) as never,
      readAllForIndex: () => Effect.succeed([]),
      createNote: () => Effect.succeed({} as never),
      updateNote: () => Effect.succeed({} as never),
      appendToNote: () => Effect.succeed({} as never),
      editNote: () => Effect.succeed({} as never),
      deleteNote: deleteSpy as never,
    };
    const runtime = ManagedRuntime.make(Layer.succeed(Vault, stub));
    const inner = await runtime.runtime();
    const result = await deleteNote(inner as never).handler({ path: "Notes/x.md" });
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({ ok: true, path: "Notes/x.md" });
    expect(deleteSpy).toHaveBeenCalledWith("Notes/x.md");
  });
});
