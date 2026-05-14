import { describe, expect, it } from "vitest";
import { Effect, Layer } from "effect";
import { Vault, type VaultImpl } from "./index.ts";

const stub: VaultImpl = {
  listNotes: () => Effect.succeed([]),
  listRecent: () => Effect.succeed([]),
  readNote: (path) =>
    Effect.succeed({
      path,
      _rev: "1-stub",
      frontmatter: {},
      body: "",
      mtime: 0,
      ctime: 0,
      size: 0,
    }),
  readAllForIndex: () => Effect.succeed([]),
  createNote: (path) =>
    Effect.succeed({
      path,
      _rev: "1-stub",
      frontmatter: {},
      body: "",
      mtime: 0,
      ctime: 0,
      size: 0,
    }),
  updateNote: (path) =>
    Effect.succeed({
      path,
      _rev: "2-stub",
      frontmatter: {},
      body: "",
      mtime: 0,
      ctime: 0,
      size: 0,
    }),
  appendToNote: (path) =>
    Effect.succeed({
      path,
      _rev: "2-stub",
      frontmatter: {},
      body: "",
      mtime: 0,
      ctime: 0,
      size: 0,
    }),
  editNote: (path) =>
    Effect.succeed({
      path,
      _rev: "2-stub",
      frontmatter: {},
      body: "",
      mtime: 0,
      ctime: 0,
      size: 0,
    }),
  deleteNote: () => Effect.void,
};

describe("Vault", () => {
  it("acts as a Context tag — provided implementations are recoverable", async () => {
    const out = await Effect.runPromise(
      Effect.gen(function* () {
        const v = yield* Vault;
        return yield* v.readNote("Daily/2026-05-02.md");
      }).pipe(Effect.provide(Layer.succeed(Vault, stub))),
    );
    expect(out.path).toBe("Daily/2026-05-02.md");
    expect(out._rev).toBe("1-stub");
  });
});
