import { describe, expect, it, vi } from "vitest";
import { Effect, Layer, Redacted } from "effect";
import { encryptWithEphemeralSalt } from "octagonal-wheels/encryption/hkdf.js";
import { VaultLayer } from "./index.ts";
import { CouchClient, type CouchClientImpl } from "../CouchClient";
import { Vault } from "../Vault";
import { path2id } from "../path2id";
import type { ChunkDoc, NoteDoc } from "../types.ts";

const passphrase = "vault-test-pass";
const redacted = Redacted.make(passphrase);

const buildStubClient = (notes: NoteDoc[], chunks: ChunkDoc[]): CouchClientImpl => {
  const noteById = new Map(notes.map((n) => [n._id, n]));
  const chunkById = new Map(chunks.map((c) => [c._id, c]));
  return {
    getDoc: (id) => {
      const v = noteById.get(id) ?? chunkById.get(id);
      return Effect.succeed(v as never);
    },
    getDocs: (ids) =>
      Effect.succeed(
        (ids.map((id) => chunkById.get(id) ?? noteById.get(id)).filter(Boolean) as never[]) as never,
      ),
    putDoc: vi.fn((doc) => Effect.succeed({ ...doc, _rev: "2-stub" } as never)) as never,
    bulkPut: vi.fn((docs: ReadonlyArray<{ _id: string }>) =>
      Effect.succeed(docs.map((d) => ({ id: d._id, rev: "1-stub", ok: true }))),
    ) as never,
    listNoteDocs: () => Effect.succeed(notes as ReadonlyArray<NoteDoc>),
    raw: () => ({}) as never,
  };
};

describe("VaultLayer", () => {
  it("readNote reassembles and decrypts a chunked note", async () => {
    const noteId = await Effect.runPromise(path2id("hello.md", passphrase));
    const chunkA = await encryptWithEphemeralSalt("Hello, ", passphrase);
    const chunkB = await encryptWithEphemeralSalt("world.", passphrase);
    const encryptedPath = await encryptWithEphemeralSalt("f:hello.md", passphrase);
    const note: NoteDoc = {
      _id: noteId,
      _rev: "1-x",
      type: "plain",
      path: encryptedPath,
      children: ["h:a", "h:b"],
      ctime: 1,
      mtime: 2,
      size: 13,
    };
    const chunks: ChunkDoc[] = [
      { _id: "h:a", type: "leaf", data: chunkA },
      { _id: "h:b", type: "leaf", data: chunkB },
    ];
    const client = buildStubClient([note], chunks);

    const out = await Effect.runPromise(
      Effect.gen(function* () {
        const v = yield* Vault;
        return yield* v.readNote("hello.md");
      }).pipe(
        Effect.provide(VaultLayer(redacted).pipe(Layer.provide(Layer.succeed(CouchClient, client)))),
      ),
    );
    expect(out.path).toBe("hello.md");
    expect(out.body).toBe("Hello, world.");
  });

  it("readNote fails with NoteNotFoundError for an unknown path", async () => {
    const client = buildStubClient([], []);
    const exit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const v = yield* Vault;
        return yield* v.readNote("does-not-exist.md");
      }).pipe(
        Effect.provide(VaultLayer(redacted).pipe(Layer.provide(Layer.succeed(CouchClient, client)))),
      ),
    );
    expect(exit._tag).toBe("Failure");
    if (exit._tag === "Failure") {
      expect(JSON.stringify(exit.cause)).toContain("NoteNotFoundError");
    }
  });
});
