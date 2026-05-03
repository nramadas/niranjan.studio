import { describe, expect, it, vi } from "vitest";
import { Effect, Layer, Redacted } from "effect";
import { encrypt as encryptHkdf } from "octagonal-wheels/encryption/hkdf.js";
import { VaultLayer } from "./index.ts";
import { CouchClient, type CouchClientImpl } from "../CouchClient";
import { Vault } from "../Vault";
import { ENCRYPTED_META_PREFIX, SYNC_PARAMETERS_DOC_ID } from "../constants.ts";
import { path2id } from "../path2id";
import type { ChunkDoc, NoteDoc } from "../types.ts";

const passphrase = "vault-test-pass";
const redacted = Redacted.make(passphrase);

const fixedSalt = (() => {
  const ab = new ArrayBuffer(32);
  const v = new Uint8Array(ab);
  for (let i = 0; i < 32; i++) v[i] = (i * 7 + 3) & 0xff;
  return v;
})();

const fixedSaltBase64 = Buffer.from(fixedSalt).toString("base64");

interface SyncParamsDoc {
  _id: string;
  type: string;
  protocolVersion: number;
  pbkdf2salt: string;
}

const SYNC_PARAMS_DOC: SyncParamsDoc = {
  _id: SYNC_PARAMETERS_DOC_ID,
  type: "sync-parameters",
  protocolVersion: 2,
  pbkdf2salt: fixedSaltBase64,
};

const buildStubClient = (notes: NoteDoc[], chunks: ChunkDoc[]): CouchClientImpl => {
  const noteById = new Map(notes.map((n) => [n._id, n]));
  const chunkById = new Map(chunks.map((c) => [c._id, c]));
  return {
    getDoc: (id) => {
      if (id === SYNC_PARAMETERS_DOC_ID) return Effect.succeed(SYNC_PARAMS_DOC as never);
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
  it("readNote reassembles and decrypts a chunked note (V2 obfuscated-meta format)", async () => {
    const noteId = await Effect.runPromise(path2id("hello.md", passphrase));
    const chunkA = await encryptHkdf("Hello, ", passphrase, fixedSalt);
    const chunkB = await encryptHkdf("world.", passphrase, fixedSalt);
    const metaJson = JSON.stringify({
      path: "f:hello.md",
      mtime: 1700000002000,
      ctime: 1700000001000,
      size: 13,
      children: ["h:a", "h:b"],
    });
    const encryptedMeta = await encryptHkdf(metaJson, passphrase, fixedSalt);
    const note: NoteDoc = {
      _id: noteId,
      _rev: "1-x",
      type: "plain",
      path: `${ENCRYPTED_META_PREFIX}${encryptedMeta}`,
      children: [],
      ctime: 0,
      mtime: 0,
      size: 0,
      eden: {},
    };
    const chunks: ChunkDoc[] = [
      { _id: "h:a", type: "leaf", data: chunkA, e_: true },
      { _id: "h:b", type: "leaf", data: chunkB, e_: true },
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
    expect(out.mtime).toBe(1700000002000);
    expect(out.size).toBe(13);
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
