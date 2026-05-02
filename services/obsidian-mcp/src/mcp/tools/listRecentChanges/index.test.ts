import { describe, expect, it, vi } from "vitest";
import { Effect, Layer, ManagedRuntime } from "effect";
import { listRecentChanges } from "./index.ts";
import { Vault, type VaultImpl } from "../../../couchdb/Vault";

describe("listRecentChanges tool", () => {
  it("invokes Vault.listRecent with the supplied limit", async () => {
    const recentSpy = vi.fn(() => Effect.succeed([]));
    const stub: VaultImpl = {
      listNotes: () => Effect.succeed([]),
      listRecent: recentSpy as never,
      readNote: () => Effect.succeed({} as never),
      readAllForIndex: () => Effect.succeed([]),
      createNote: () => Effect.succeed({} as never),
      updateNote: () => Effect.succeed({} as never),
      appendToNote: () => Effect.succeed({} as never),
      deleteNote: () => Effect.void,
    };
    const runtime = ManagedRuntime.make(Layer.succeed(Vault, stub));
    const inner = await runtime.runtime();
    await listRecentChanges(inner as never).handler({ limit: 7 });
    expect(recentSpy).toHaveBeenCalledWith(7);
  });

  it("defaults the limit to 20", async () => {
    const recentSpy = vi.fn(() => Effect.succeed([]));
    const stub: VaultImpl = {
      listNotes: () => Effect.succeed([]),
      listRecent: recentSpy as never,
      readNote: () => Effect.succeed({} as never),
      readAllForIndex: () => Effect.succeed([]),
      createNote: () => Effect.succeed({} as never),
      updateNote: () => Effect.succeed({} as never),
      appendToNote: () => Effect.succeed({} as never),
      deleteNote: () => Effect.void,
    };
    const runtime = ManagedRuntime.make(Layer.succeed(Vault, stub));
    const inner = await runtime.runtime();
    await listRecentChanges(inner as never).handler({});
    expect(recentSpy).toHaveBeenCalledWith(20);
  });
});
