import { describe, expect, it } from "vitest";
import { Effect, Layer, ManagedRuntime } from "effect";
import { listNotes } from "./index.ts";
import { Vault, type VaultImpl } from "../../../couchdb/Vault";

const stubVault: VaultImpl = {
  listNotes: (folderPrefix, limit) =>
    Effect.succeed(
      [
        { path: "Daily/2026-05-01.md", title: "2026-05-01", mtime: 1, size: 10 },
        { path: "Notes/x.md", title: "x", mtime: 2, size: 20 },
      ]
        .filter((s) => !folderPrefix || s.path.startsWith(folderPrefix))
        .slice(0, limit),
    ),
  listRecent: () => Effect.succeed([]),
  readNote: () => Effect.succeed({} as never),
  readAllForIndex: () => Effect.succeed([]),
  createNote: () => Effect.succeed({} as never),
  updateNote: () => Effect.succeed({} as never),
  appendToNote: () => Effect.succeed({} as never),
  deleteNote: () => Effect.void,
};

describe("listNotes tool", () => {
  it("registers under the name list_notes with a description", async () => {
    const runtime = ManagedRuntime.make(Layer.succeed(Vault, stubVault));
    const inner = await runtime.runtime();
    const tool = listNotes(inner as never);
    expect(tool.name).toBe("list_notes");
    expect(tool.config.title).toBe("List notes");
    expect(typeof tool.config.description).toBe("string");
  });

  it("invokes Vault.listNotes and returns a structured tool result", async () => {
    const runtime = ManagedRuntime.make(Layer.succeed(Vault, stubVault));
    const inner = await runtime.runtime();
    const result = await listNotes(inner as never).handler({ folder_prefix: "Daily/" });
    expect(result.isError).toBeUndefined();
    const items = (result.structuredContent as { items: unknown[] }).items;
    expect(items).toHaveLength(1);
  });
});
