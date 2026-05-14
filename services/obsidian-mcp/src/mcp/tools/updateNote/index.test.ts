import { describe, expect, it, vi } from "vitest";
import { Effect, Layer, ManagedRuntime } from "effect";
import { updateNote } from "./index.ts";
import { Vault, type VaultImpl } from "../../../couchdb/Vault";

describe("updateNote tool", () => {
  it("invokes Vault.updateNote with the supplied patch", async () => {
    const updateSpy = vi.fn((path: string, body, fm) =>
      Effect.succeed({
        path,
        _rev: "2-x",
        frontmatter: fm ?? {},
        body: body ?? "old",
        mtime: 2,
        ctime: 1,
        size: (body ?? "old").length,
      }),
    );
    const stub: VaultImpl = {
      listNotes: () => Effect.succeed([]),
      listRecent: () => Effect.succeed([]),
      readNote: () => Effect.succeed({} as never),
      readAllForIndex: () => Effect.succeed([]),
      createNote: () => Effect.succeed({} as never),
      updateNote: updateSpy as never,
      appendToNote: () => Effect.succeed({} as never),
      editNote: () => Effect.succeed({} as never),
      deleteNote: () => Effect.void,
    };
    const runtime = ManagedRuntime.make(Layer.succeed(Vault, stub));
    const inner = await runtime.runtime();
    const result = await updateNote(inner as never).handler({
      path: "Notes/x.md",
      body: "new body",
      frontmatter: { tag: "v2" },
    });
    expect(result.isError).toBeUndefined();
    expect(updateSpy).toHaveBeenCalledWith("Notes/x.md", "new body", { tag: "v2" });
  });
});
