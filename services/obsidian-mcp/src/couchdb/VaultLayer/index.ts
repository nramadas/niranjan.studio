import { Effect, Layer, Redacted } from "effect";
import { CouchDbError } from "../../lib/errors/CouchDbError";
import { DecryptionError } from "../../lib/errors/DecryptionError";
import { EncryptionError } from "../../lib/errors/EncryptionError";
import { NoteConflictError } from "../../lib/errors/NoteConflictError";
import { NoteNotFoundError } from "../../lib/errors/NoteNotFoundError";
import { CouchClient, type CouchClientImpl } from "../CouchClient";
import { Vault, type VaultImpl } from "../Vault";
import { assembleChunks } from "../assembleChunks";
import { chunkId } from "../chunkId";
import { decryptField } from "../decryptField";
import { encryptField } from "../encryptField";
import { isNoteDoc } from "../isNoteDoc";
import { path2id } from "../path2id";
import { splitIntoChunks } from "../splitIntoChunks";
import type { ChunkDoc, NoteDoc, NoteRead, NoteSummary } from "../types.ts";

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n?/;

// Minimal YAML subset: `key: value` per line, value is a string. Keeps us
// out of the full YAML-spec rabbit hole; the LiveSync vault is
// user-controlled, but the MCP tools expose frontmatter as an opaque
// record back to the client anyway.
const parseFrontmatter = (raw: string): { frontmatter: Record<string, unknown>; body: string } => {
  const match = FRONTMATTER_RE.exec(raw);
  if (!match) return { frontmatter: {}, body: raw };
  const yaml = match[1] ?? "";
  const fm: Record<string, unknown> = {};
  for (const line of yaml.split("\n")) {
    const m = /^([A-Za-z0-9_\-]+)\s*:\s*(.*)$/.exec(line.trim());
    if (m && m[1] !== undefined) fm[m[1]] = m[2] ?? "";
  }
  return { frontmatter: fm, body: raw.slice(match[0].length) };
};

const formatFrontmatter = (fm: Record<string, unknown>, body: string): string => {
  const keys = Object.keys(fm);
  if (keys.length === 0) return body;
  const lines = keys.map((k) => `${k}: ${String(fm[k] ?? "")}`).join("\n");
  return `---\n${lines}\n---\n${body}`;
};

const titleFromPath = (p: string): string => {
  const base = p.split("/").pop() ?? p;
  return base.replace(/\.md$/i, "");
};

const buildImpl = (
  client: CouchClientImpl,
  passphrase: Redacted.Redacted<string>,
): VaultImpl => {
  const obfuscateOn = Redacted.value(passphrase).length > 0;
  const obfPassphrase = obfuscateOn ? Redacted.value(passphrase) : false;

  const decryptPath = (
    doc: NoteDoc,
  ): Effect.Effect<string, DecryptionError> =>
    decryptField(doc.path, passphrase, doc._id).pipe(
      Effect.map((p) => (p.startsWith("f:") ? p.slice(2) : p)),
    );

  const summarise = (doc: NoteDoc) =>
    decryptPath(doc).pipe(
      Effect.map<string, NoteSummary>((path) => ({
        path,
        title: titleFromPath(path),
        mtime: doc.mtime,
        size: doc.size,
      })),
    );

  const fetchNoteByDoc = (doc: NoteDoc) =>
    Effect.gen(function* () {
      const path = yield* decryptPath(doc);
      const chunks = yield* client.getDocs<ChunkDoc>(doc.children);
      // CouchDB returns chunks in arbitrary order; reorder by the children array.
      const byId = new Map(chunks.map((c) => [c._id, c]));
      const orderedDecrypted: string[] = [];
      for (const id of doc.children) {
        const chunk = byId.get(id);
        if (!chunk) {
          // Missing chunk — likely a partial replication; surface as
          // empty so the rest of the note is still readable.
          orderedDecrypted.push("");
          continue;
        }
        const plain = yield* decryptField(chunk.data, passphrase, chunk._id);
        orderedDecrypted.push(plain);
      }
      const raw = assembleChunks(orderedDecrypted);
      const parsed = parseFrontmatter(raw);
      const out: NoteRead = {
        path,
        _rev: doc._rev ?? "",
        frontmatter: parsed.frontmatter,
        body: parsed.body,
        mtime: doc.mtime,
        ctime: doc.ctime,
        size: doc.size,
      };
      return out;
    });

  const findNoteDocByPath = (
    path: string,
  ): Effect.Effect<NoteDoc | undefined, CouchDbError | EncryptionError> =>
    Effect.gen(function* () {
      const id = yield* path2id(path, obfPassphrase, false);
      const doc = yield* client.getDoc(id);
      if (doc && isNoteDoc(doc)) return doc;
      return undefined;
    });

  const writeChunksAndNote = (
    path: string,
    raw: string,
    existing: NoteDoc | undefined,
  ): Effect.Effect<NoteRead, CouchDbError | EncryptionError | NoteConflictError> =>
    Effect.gen(function* () {
      const noteId = yield* path2id(path, obfPassphrase, false);
      const plainChunks = splitIntoChunks(raw);
      // Compute deterministic chunk IDs from PRE-encryption content so
      // dedup matches what LiveSync would do client-side.
      const chunkIds = yield* Effect.tryPromise({
        try: () => Promise.all(plainChunks.map(chunkId)),
        catch: (cause) =>
          new CouchDbError({ op: "chunkId", message: "failed to derive chunk ids", cause }),
      });
      const encryptedChunks = yield* Effect.all(
        plainChunks.map((c, i) =>
          encryptField(c, passphrase, path).pipe(
            Effect.map<string, ChunkDoc>((data) => ({
              _id: chunkIds[i] ?? `h:${i}`,
              type: "leaf" as const,
              data,
            })),
          ),
        ),
        { concurrency: 8 },
      );
      // Only insert chunks that don't already exist. CouchDB will 409 on
      // collision; cheap to do a getDocs first and filter.
      const existingChunks = yield* client.getDocs<ChunkDoc>(chunkIds);
      const have = new Set(existingChunks.map((c) => c._id));
      const toInsert = encryptedChunks.filter((c) => !have.has(c._id));
      if (toInsert.length > 0) {
        yield* client.bulkPut(toInsert);
      }

      const encryptedPath = yield* (obfuscateOn
        ? encryptField(`f:${path}`, passphrase, path)
        : Effect.succeed(path));

      const now = Date.now();
      const noteDoc: NoteDoc = {
        _id: noteId,
        type: "plain" as const,
        path: encryptedPath,
        children: chunkIds,
        ctime: existing?.ctime ?? now,
        mtime: now,
        size: raw.length,
      };
      if (existing?._rev) {
        (noteDoc as NoteDoc & { _rev: string })._rev = existing._rev;
      }
      const putWithConflictMap: Effect.Effect<
        NoteDoc & { _rev: string },
        CouchDbError | NoteConflictError
      > = client.putDoc(noteDoc).pipe(
        Effect.mapError((e) => {
          if (e._tag === "CouchDbError" && e.status === 409) {
            return new NoteConflictError({
              path,
              message:
                "rev conflict on write — another client updated the note. Read again and retry.",
            });
          }
          return e;
        }),
      );
      const result: NoteDoc & { _rev: string } = yield* putWithConflictMap;

      return {
        path,
        _rev: result._rev,
        frontmatter: {},
        body: raw,
        ctime: noteDoc.ctime,
        mtime: noteDoc.mtime,
        size: noteDoc.size,
      } satisfies NoteRead;
    });

  const writeWithRetry = (path: string, raw: string) =>
    Effect.gen(function* () {
      const existing = yield* findNoteDocByPath(path);
      return yield* writeChunksAndNote(path, raw, existing).pipe(
        Effect.catchTag("NoteConflictError", () =>
          Effect.gen(function* () {
            const fresh = yield* findNoteDocByPath(path);
            return yield* writeChunksAndNote(path, raw, fresh);
          }),
        ),
      );
    });

  return {
    listNotes: (folderPrefix, limit) =>
      Effect.gen(function* () {
        // We can't filter by path server-side when paths are encrypted —
        // we have to fetch all notes and filter in memory. For a
        // personal vault (low thousands of notes) this is fine. If your
        // vault is huge, add a Mango index on mtime and narrow there.
        const docs = yield* client.listNoteDocs({ limit: limit * 4 });
        const summaries = yield* Effect.all(docs.map(summarise), { concurrency: 16 });
        const filtered = folderPrefix
          ? summaries.filter((s) => s.path.startsWith(folderPrefix))
          : summaries;
        return filtered.slice(0, limit);
      }),

    listRecent: (limit) =>
      Effect.gen(function* () {
        const docs = yield* client.listNoteDocs({ limit: limit * 4 });
        const summaries = yield* Effect.all(docs.map(summarise), { concurrency: 16 });
        return [...summaries].sort((a, b) => b.mtime - a.mtime).slice(0, limit);
      }),

    readNote: (path) =>
      Effect.gen(function* () {
        const doc = yield* findNoteDocByPath(path);
        if (!doc) return yield* Effect.fail(new NoteNotFoundError({ path }));
        return yield* fetchNoteByDoc(doc);
      }),

    readAllForIndex: () =>
      Effect.gen(function* () {
        const docs = yield* client.listNoteDocs({ limit: 10_000 });
        return yield* Effect.all(docs.map(fetchNoteByDoc), { concurrency: 8 });
      }),

    createNote: (path, body, frontmatter) =>
      Effect.gen(function* () {
        const existing = yield* findNoteDocByPath(path);
        if (existing) {
          return yield* Effect.fail(
            new NoteConflictError({
              path,
              message: "note already exists at this path; use update_note to modify it",
            }),
          );
        }
        const raw = formatFrontmatter(frontmatter ?? {}, body);
        return yield* writeWithRetry(path, raw);
      }),

    updateNote: (path, bodyPatch, fmPatch) =>
      Effect.gen(function* () {
        const doc = yield* findNoteDocByPath(path);
        if (!doc) return yield* Effect.fail(new NoteNotFoundError({ path }));
        const current = yield* fetchNoteByDoc(doc);
        const fm = { ...current.frontmatter, ...(fmPatch ?? {}) };
        const body = bodyPatch ?? current.body;
        const raw = formatFrontmatter(fm, body);
        return yield* writeWithRetry(path, raw);
      }),

    appendToNote: (path, content) =>
      Effect.gen(function* () {
        const doc = yield* findNoteDocByPath(path);
        if (!doc) return yield* Effect.fail(new NoteNotFoundError({ path }));
        const current = yield* fetchNoteByDoc(doc);
        const body = current.body.endsWith("\n")
          ? current.body + content
          : `${current.body}\n${content}`;
        const raw = formatFrontmatter(current.frontmatter, body);
        return yield* writeWithRetry(path, raw);
      }),

    deleteNote: (path) =>
      Effect.gen(function* () {
        const doc = yield* findNoteDocByPath(path);
        if (!doc) return yield* Effect.fail(new NoteNotFoundError({ path }));
        const current = yield* fetchNoteByDoc(doc);
        // Soft-delete: move to .trash/<original-path>. Keeps the
        // original _id alive (no deletion tombstone) so LiveSync clients
        // see this as a rename, not a delete.
        const trashedPath = `.trash/${path}`;
        yield* writeWithRetry(trashedPath, current.body);
        const trashedDoc = yield* findNoteDocByPath(path);
        if (trashedDoc?._rev) {
          const tomb: NoteDoc = { ...trashedDoc, _deleted: true };
          yield* client.putDoc(tomb).pipe(Effect.asVoid);
        }
      }),
  };
};

/**
 * Build the Layer that provides the `Vault` tag. Depends on the
 * `CouchClient` tag (also resolved via Layer); the LiveSync passphrase
 * is captured at construction time so the resulting Vault is bound to a
 * single passphrase for its lifetime.
 *
 * @param passphrase The LiveSync E2EE passphrase, redacted.
 * @returns          A Layer that provides Vault and depends on CouchClient.
 */
export const VaultLayer = (passphrase: Redacted.Redacted<string>) =>
  Layer.effect(
    Vault,
    Effect.map(CouchClient, (client) => buildImpl(client, passphrase)),
  );
