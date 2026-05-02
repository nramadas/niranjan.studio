import { describe, expect, it } from "vitest";
import { Effect, Layer } from "effect";
import { SearchIndexLayer } from "./index.ts";
import { SearchIndex } from "../SearchIndex";
import { Vault, type VaultImpl } from "../../couchdb/Vault";
import type { NoteRead } from "../../couchdb/types.ts";

const stubVault = (notes: NoteRead[]): VaultImpl => ({
  listNotes: () => Effect.succeed([]),
  listRecent: () => Effect.succeed([]),
  readNote: () =>
    Effect.succeed({
      path: "",
      _rev: "",
      frontmatter: {},
      body: "",
      mtime: 0,
      ctime: 0,
      size: 0,
    }),
  readAllForIndex: () => Effect.succeed(notes),
  createNote: () => Effect.succeed({} as never),
  updateNote: () => Effect.succeed({} as never),
  appendToNote: () => Effect.succeed({} as never),
  deleteNote: () => Effect.void,
});

const mkNote = (path: string, body: string): NoteRead => ({
  path,
  _rev: "1-x",
  frontmatter: {},
  body,
  mtime: 0,
  ctime: 0,
  size: body.length,
});

describe("SearchIndexLayer", () => {
  it("ranks documents by BM25 with title weight 2x", async () => {
    // No stemming by design — every match is an exact-token match.
    const notes = [
      mkNote("apple.md", "this note mentions orange occasionally"),
      mkNote("orange.md", "this is the canonical note about orange"),
      mkNote("unrelated.md", "different topic entirely"),
    ];
    const layer = SearchIndexLayer(5000).pipe(Layer.provide(Layer.succeed(Vault, stubVault(notes))));
    const hits = await Effect.runPromise(
      Effect.gen(function* () {
        const idx = yield* SearchIndex;
        return yield* idx.query("orange", 5);
      }).pipe(Effect.provide(layer)),
    );
    expect(hits.length).toBeGreaterThanOrEqual(2);
    // "orange.md" wins because the term appears in the title (weight 2x)
    // AND the body, vs only the body in "apple.md".
    expect(hits[0]?.path).toBe("orange.md");
  });

  it("returns empty array when no documents match", async () => {
    const notes = [mkNote("x.md", "the only note in the vault")];
    const layer = SearchIndexLayer(5000).pipe(Layer.provide(Layer.succeed(Vault, stubVault(notes))));
    const hits = await Effect.runPromise(
      Effect.gen(function* () {
        const idx = yield* SearchIndex;
        return yield* idx.query("missing", 5);
      }).pipe(Effect.provide(layer)),
    );
    expect(hits).toEqual([]);
  });
});
