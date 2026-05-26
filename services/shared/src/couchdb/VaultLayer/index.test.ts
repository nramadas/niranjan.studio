import { Effect, Layer, Redacted } from "effect";
import {
  decrypt as decryptHkdf,
  encrypt as encryptHkdf,
} from "octagonal-wheels/encryption/hkdf.js";
import { describe, expect, it, vi } from "vitest";
import { CouchClient, type CouchClientImpl } from "../CouchClient";
import { Vault } from "../Vault";
import { ENCRYPTED_META_PREFIX, SYNC_PARAMETERS_DOC_ID } from "../constants.ts";
import { path2id } from "../path2id";
import type { ChunkDoc, NoteDoc } from "../types.ts";
import { VaultLayer } from "./index.ts";

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
        ids.map((id) => chunkById.get(id) ?? noteById.get(id)).filter(Boolean) as never[] as never,
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
        Effect.provide(
          VaultLayer(redacted).pipe(Layer.provide(Layer.succeed(CouchClient, client))),
        ),
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
        Effect.provide(
          VaultLayer(redacted).pipe(Layer.provide(Layer.succeed(CouchClient, client))),
        ),
      ),
    );
    expect(exit._tag).toBe("Failure");
    if (exit._tag === "Failure") {
      expect(JSON.stringify(exit.cause)).toContain("NoteNotFoundError");
    }
  });

  it("createNote renders array-valued frontmatter as YAML inline sequence and read parses it back as an array", async () => {
    // Capture the chunks the layer encrypts on write, so we can decrypt
    // them and inspect the YAML it emitted.
    const writtenChunks: ChunkDoc[] = [];
    const client = buildStubClient([], []);
    (client.bulkPut as unknown as ReturnType<typeof vi.fn>) = vi.fn(
      (docs: ReadonlyArray<ChunkDoc>) => {
        writtenChunks.push(...docs);
        return Effect.succeed(docs.map((d) => ({ id: d._id, rev: "1-stub", ok: true })));
      },
    ) as never;

    const createResult = await Effect.runPromise(
      Effect.gen(function* () {
        const v = yield* Vault;
        return yield* v.createNote("tagged.md", "Body text", {
          tags: ["draft", "idea", "weekly"],
          status: "in-progress",
          published: false,
        });
      }).pipe(
        Effect.provide(
          VaultLayer(redacted).pipe(Layer.provide(Layer.succeed(CouchClient, client))),
        ),
      ),
    );

    // The response parses back into structured form (array stays an array,
    // boolean stays a boolean) so callers don't have to re-parse a string.
    expect(createResult.frontmatter).toEqual({
      tags: ["draft", "idea", "weekly"],
      status: "in-progress",
      published: false,
    });

    // Verify the YAML we actually serialized: decrypt the first chunk and
    // peek at the rendered frontmatter block. The `tags: [...]` form is
    // what Obsidian's frontmatter parser treats as a list (vs the broken
    // `tags: draft,idea,weekly` we used to emit).
    expect(writtenChunks).toHaveLength(1);
    const firstChunk = writtenChunks[0];
    if (!firstChunk) throw new Error("expected one chunk");
    const chunkData = await decryptHkdf(firstChunk.data, passphrase, fixedSalt);
    expect(chunkData).toContain("tags: [draft, idea, weekly]");
    expect(chunkData).toContain("status: in-progress");
    expect(chunkData).toContain("published: false");
  });

  it("createNote stores UTF-8 byte length (not UTF-16 char length) in the meta blob size", async () => {
    // Content with em-dashes and a curly apostrophe — each em-dash is 1
    // UTF-16 unit but 3 UTF-8 bytes, the apostrophe is 1 unit but 3 bytes.
    // The plugin computes size as bytes; if we used `raw.length` (UTF-16
    // units) the plugin's integrity check would fail with "File … seems
    // to be corrupted! Writing prevented. (charLen != byteLen)" and the
    // file would never appear in the local vault.
    const body = "Two em-dashes — and — a curly apostrophe’s test.";
    const charLength = body.length;
    const byteLength = Buffer.byteLength(body, "utf8");
    expect(charLength).not.toBe(byteLength); // sanity: input actually has multi-byte chars

    const writtenNotes: NoteDoc[] = [];
    const writtenChunks: ChunkDoc[] = [];
    const client = buildStubClient([], []);
    (client.putDoc as unknown as ReturnType<typeof vi.fn>) = vi.fn(
      (doc: { _id: string; type?: string }) => {
        if (doc.type === "plain" || doc.type === "newnote") writtenNotes.push(doc as NoteDoc);
        return Effect.succeed({ ...doc, _rev: "1-stub" } as never);
      },
    ) as never;
    (client.bulkPut as unknown as ReturnType<typeof vi.fn>) = vi.fn(
      (docs: ReadonlyArray<ChunkDoc>) => {
        writtenChunks.push(...docs);
        return Effect.succeed(docs.map((d) => ({ id: d._id, rev: "1-stub", ok: true })));
      },
    ) as never;

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const v = yield* Vault;
        return yield* v.createNote("multibyte.md", body, undefined);
      }).pipe(
        Effect.provide(
          VaultLayer(redacted).pipe(Layer.provide(Layer.succeed(CouchClient, client))),
        ),
      ),
    );

    // The response shape carries the byte size — what callers (and read_note) see.
    expect(result.size).toBe(byteLength);

    // The encrypted meta blob is what the plugin reads. Its `size` field
    // is the value the plugin's integrity check compares against.
    expect(writtenNotes).toHaveLength(1);
    const noteDoc = writtenNotes[0]!;
    expect(noteDoc.path.startsWith(ENCRYPTED_META_PREFIX)).toBe(true);
    const ciphertext = noteDoc.path.slice(ENCRYPTED_META_PREFIX.length);
    const metaJson = await decryptHkdf(ciphertext, passphrase, fixedSalt);
    const meta = JSON.parse(metaJson) as { size: number; path: string };
    expect(meta.size).toBe(byteLength);
    expect(meta.size).not.toBe(charLength);
    expect(meta.path).toBe("multibyte.md");
  });

  it("editNote applies a find/replace and only the changed region is rewritten in the response body", async () => {
    const noteId = await Effect.runPromise(path2id("edit-target.md", passphrase));
    const originalBody = "alpha beta gamma";
    const chunk = await encryptHkdf(originalBody, passphrase, fixedSalt);
    const metaJson = JSON.stringify({
      path: "edit-target.md",
      mtime: 100,
      ctime: 50,
      size: Buffer.byteLength(originalBody, "utf8"),
      children: ["h:+orig"],
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
    const client = buildStubClient(
      [note],
      [{ _id: "h:+orig", type: "leaf", data: chunk, e_: true }],
    );

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const v = yield* Vault;
        return yield* v.editNote("edit-target.md", "beta", "BETA", false);
      }).pipe(
        Effect.provide(
          VaultLayer(redacted).pipe(Layer.provide(Layer.succeed(CouchClient, client))),
        ),
      ),
    );
    expect(result.body).toBe("alpha BETA gamma");
    // ctime preserved across the edit (was 50 in the original meta).
    expect(result.ctime).toBe(50);
  });

  it("editNote fails with StringMatchError when the search string isn't present", async () => {
    const noteId = await Effect.runPromise(path2id("nothing-matches.md", passphrase));
    const chunk = await encryptHkdf("just some body", passphrase, fixedSalt);
    const metaJson = JSON.stringify({
      path: "nothing-matches.md",
      mtime: 1,
      ctime: 1,
      size: 14,
      children: ["h:+x"],
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
    const client = buildStubClient([note], [{ _id: "h:+x", type: "leaf", data: chunk, e_: true }]);

    const exit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const v = yield* Vault;
        return yield* v.editNote("nothing-matches.md", "absent", "new", false);
      }).pipe(
        Effect.provide(
          VaultLayer(redacted).pipe(Layer.provide(Layer.succeed(CouchClient, client))),
        ),
      ),
    );
    expect(exit._tag).toBe("Failure");
    if (exit._tag === "Failure") {
      const serialised = JSON.stringify(exit.cause);
      expect(serialised).toContain("StringMatchError");
      expect(serialised).toContain("not_found");
    }
  });

  it("editNote fails ambiguous when old_string occurs multiple times and replace_all is false", async () => {
    const noteId = await Effect.runPromise(path2id("ambig.md", passphrase));
    const body = "foo bar foo bar foo";
    const chunk = await encryptHkdf(body, passphrase, fixedSalt);
    const metaJson = JSON.stringify({
      path: "ambig.md",
      mtime: 1,
      ctime: 1,
      size: Buffer.byteLength(body, "utf8"),
      children: ["h:+y"],
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
    const client = buildStubClient([note], [{ _id: "h:+y", type: "leaf", data: chunk, e_: true }]);

    // replace_all=false → ambiguous error
    const ambig = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const v = yield* Vault;
        return yield* v.editNote("ambig.md", "foo", "FOO", false);
      }).pipe(
        Effect.provide(
          VaultLayer(redacted).pipe(Layer.provide(Layer.succeed(CouchClient, client))),
        ),
      ),
    );
    expect(ambig._tag).toBe("Failure");
    if (ambig._tag === "Failure") {
      const serialised = JSON.stringify(ambig.cause);
      expect(serialised).toContain("StringMatchError");
      expect(serialised).toContain("ambiguous");
      expect(serialised).toContain('"occurrences":3');
    }

    // replace_all=true → succeeds and rewrites every occurrence
    const all = await Effect.runPromise(
      Effect.gen(function* () {
        const v = yield* Vault;
        return yield* v.editNote("ambig.md", "foo", "FOO", true);
      }).pipe(
        Effect.provide(
          VaultLayer(redacted).pipe(Layer.provide(Layer.succeed(CouchClient, client))),
        ),
      ),
    );
    expect(all.body).toBe("FOO bar FOO bar FOO");
  });
});
