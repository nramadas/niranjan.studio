import { Effect, Layer, Redacted } from "effect";
import { decrypt as decryptHkdf } from "octagonal-wheels/encryption/hkdf.js";
import { CouchDbError } from "../../lib/errors/CouchDbError";
import { DecryptionError } from "../../lib/errors/DecryptionError";
import { EncryptionError } from "../../lib/errors/EncryptionError";
import { NoteConflictError } from "../../lib/errors/NoteConflictError";
import { NoteNotFoundError } from "../../lib/errors/NoteNotFoundError";
import { StringMatchError } from "../../lib/errors/StringMatchError";
import { CouchClient, type CouchClientImpl } from "../CouchClient";
import { Vault, type VaultImpl } from "../Vault";
import { assembleChunks } from "../assembleChunks";
import { chunkId } from "../chunkId";
import { EDEN_ENCRYPTED_KEY_HKDF, ENCRYPTED_META_PREFIX } from "../constants.ts";
import { decryptField } from "../decryptField";
import { type DecryptedMeta, decryptMeta } from "../decryptMeta";
import { encryptField } from "../encryptField";
import { encryptMeta } from "../encryptMeta";
import { isNoteDoc } from "../isNoteDoc";
import { path2id } from "../path2id";
import { splitIntoChunks } from "../splitIntoChunks";
import { type SyncParameters, readSyncParameters } from "../syncParameters";
import type { ChunkDoc, NoteDoc, NoteRead, NoteSummary } from "../types.ts";

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n?/;

// Minimal YAML subset: `key: value` per line, value is a string. Keeps us
// out of the full YAML-spec rabbit hole; the LiveSync vault is
// user-controlled, but the MCP tools expose frontmatter as an opaque
// record back to the client anyway.
// Render a single YAML scalar. We don't pull in a full YAML library;
// this covers the common cases (identifiers, simple strings, numbers,
// bools, null) and falls back to JSON-style double-quoting for strings
// that would otherwise be ambiguous in YAML (contain a colon, brackets,
// leading/trailing whitespace, or other reserved sigils).
const formatYamlScalar = (v: unknown): string => {
  if (v === null || v === undefined) return "";
  if (typeof v === "boolean" || typeof v === "number") return String(v);
  const s = String(v);
  if (s === "") return '""';
  if (/^\s|\s$|[:,\[\]{}#&*!|>'"%@`]/.test(s)) return JSON.stringify(s);
  return s;
};

// Inverse of formatYamlScalar — recognises the scalar forms we emit
// and the common shapes users hand-write in Obsidian frontmatter.
// Booleans, integers, floats, null and quoted strings get typed
// values; anything else falls through as a bare string.
const parseYamlScalar = (raw: string): unknown => {
  const t = raw.trim();
  if (t === "" || t === "~" || t === "null") return null;
  if (t === "true") return true;
  if (t === "false") return false;
  if (/^-?\d+$/.test(t)) return Number(t);
  if (/^-?\d+\.\d+$/.test(t)) return Number(t);
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    try {
      if (t.startsWith('"')) return JSON.parse(t);
    } catch {
      /* fall through to slice */
    }
    return t.slice(1, -1);
  }
  return t;
};

const parseYamlInlineSequence = (raw: string): unknown[] | undefined => {
  if (!raw.startsWith("[") || !raw.endsWith("]")) return undefined;
  const inner = raw.slice(1, -1).trim();
  if (inner === "") return [];
  // Naive comma-split — doesn't handle nested arrays or commas inside
  // quoted strings. Good enough for `tags: [a, b, c]`, the common
  // Obsidian shape. Stricter shapes are uncommon in frontmatter and
  // would round-trip through `read_note` as raw strings.
  return inner.split(",").map((s) => parseYamlScalar(s));
};

const parseFrontmatter = (raw: string): { frontmatter: Record<string, unknown>; body: string } => {
  const match = FRONTMATTER_RE.exec(raw);
  if (!match) return { frontmatter: {}, body: raw };
  const yaml = match[1] ?? "";
  const fm: Record<string, unknown> = {};
  for (const line of yaml.split("\n")) {
    const m = /^([A-Za-z0-9_\-]+)\s*:\s*(.*)$/.exec(line.trim());
    if (m && m[1] !== undefined) {
      const value = m[2] ?? "";
      // Recognise inline flow sequences (`[a, b, c]`) and typed
      // scalars (booleans, numbers, null, quoted strings) on read so
      // round-tripping `create_note → read_note` gives the caller back
      // structured values — not strings they'd have to re-parse.
      const asArray = parseYamlInlineSequence(value);
      fm[m[1]] = asArray ?? parseYamlScalar(value);
    }
  }
  return { frontmatter: fm, body: raw.slice(match[0].length) };
};

const formatFrontmatter = (fm: Record<string, unknown>, body: string): string => {
  const keys = Object.keys(fm);
  if (keys.length === 0) return body;
  const lines = keys
    .map((k) => {
      const v = fm[k];
      if (Array.isArray(v)) {
        // YAML inline flow sequence — `tags: [a, b]` is what the Obsidian
        // frontmatter parser expects for list-valued keys. We always emit
        // inline (not block-style) so each frontmatter entry stays on a
        // single line, matching what `parseFrontmatter` reads back.
        return `${k}: [${v.map(formatYamlScalar).join(", ")}]`;
      }
      return `${k}: ${formatYamlScalar(v)}`;
    })
    .join("\n");
  return `---\n${lines}\n---\n${body}`;
};

const titleFromPath = (p: string): string => {
  const base = p.split("/").pop() ?? p;
  return base.replace(/\.md$/i, "");
};

// "Logical" view of a note doc — the doc-level fields when path
// obfuscation is off, or the decrypted-meta values when it's on. Every
// read site goes through this so we never accidentally use the zeroed
// doc-level fields.
interface LogicalDoc {
  readonly _id: string;
  readonly _rev: string | undefined;
  readonly path: string;
  readonly mtime: number;
  readonly ctime: number;
  readonly size: number;
  readonly children: ReadonlyArray<string>;
  readonly eden: NoteDoc["eden"];
}

const buildImpl = (
  client: CouchClientImpl,
  passphrase: Redacted.Redacted<string>,
  syncParams: SyncParameters,
): VaultImpl => {
  const obfuscateOn = Redacted.value(passphrase).length > 0;
  const obfPassphrase = obfuscateOn ? Redacted.value(passphrase) : false;
  const pbkdf2Salt = syncParams.pbkdf2Salt;

  const stripFPrefix = (p: string): string => (p.startsWith("f:") ? p.slice(2) : p);

  // Resolve a note doc into the LogicalDoc shape — decrypts the meta
  // blob if the doc is using the obfuscated-properties format, or falls
  // back to doc-level fields otherwise. Strips the `f:` obfuscation
  // prefix from paths so callers always see vault-relative form.
  const toLogicalDoc = (doc: NoteDoc): Effect.Effect<LogicalDoc, DecryptionError> =>
    Effect.gen(function* () {
      if (doc.path.startsWith(ENCRYPTED_META_PREFIX)) {
        const meta = (yield* decryptMeta(doc.path, passphrase, pbkdf2Salt, doc._id)) as
          | DecryptedMeta
          | undefined;
        if (!meta) {
          // shouldn't happen — startsWith check already passed.
          return yield* Effect.fail(
            new DecryptionError({
              docId: doc._id,
              message: "decryptMeta returned undefined despite matching prefix",
            }),
          );
        }
        return {
          _id: doc._id,
          _rev: doc._rev,
          path: stripFPrefix(meta.path),
          mtime: meta.mtime,
          ctime: meta.ctime,
          size: meta.size,
          children: meta.children ?? [],
          eden: doc.eden,
        };
      }
      // No obfuscated meta — `path` may still be a plain encrypted blob
      // (older LiveSync) or actual plaintext. `decryptField` handles both.
      const decrypted = yield* decryptField(doc.path, passphrase, pbkdf2Salt, doc._id);
      return {
        _id: doc._id,
        _rev: doc._rev,
        path: stripFPrefix(decrypted),
        mtime: doc.mtime,
        ctime: doc.ctime,
        size: doc.size,
        children: doc.children,
        eden: doc.eden,
      };
    });

  const summarise = (doc: NoteDoc): Effect.Effect<NoteSummary, DecryptionError> =>
    toLogicalDoc(doc).pipe(
      Effect.map<LogicalDoc, NoteSummary>((logical) => ({
        path: logical.path,
        title: titleFromPath(logical.path),
        mtime: logical.mtime,
        size: logical.size,
      })),
    );

  // Decrypt the eden inline content if it's HKDF-encrypted. Returns the
  // parsed eden object (unencrypted shape) or undefined when there's
  // nothing to read. Eden is LiveSync's small-file fast-path — bodies of
  // tiny notes ride along on the note doc instead of going through chunks.
  const decryptEden = (
    eden: NoteDoc["eden"],
    docId: string,
  ): Effect.Effect<Record<string, unknown> | undefined, DecryptionError> =>
    Effect.gen(function* () {
      if (!eden || typeof eden !== "object") return undefined;
      const encrypted = (eden as Record<string, { data?: string } | unknown>)[
        EDEN_ENCRYPTED_KEY_HKDF
      ];
      if (
        !encrypted ||
        typeof encrypted !== "object" ||
        typeof (encrypted as { data?: unknown }).data !== "string"
      ) {
        // Empty eden, or unencrypted (we don't write this shape, but read
        // tolerantly). Treat as opaque — caller will skip.
        if (Object.keys(eden as object).length === 0) return undefined;
        return eden as Record<string, unknown>;
      }
      const ciphertext = (encrypted as { data: string }).data;
      const json = yield* Effect.tryPromise({
        try: () => decryptHkdf(ciphertext, Redacted.value(passphrase), pbkdf2Salt),
        catch: (cause) =>
          new DecryptionError({
            docId,
            message: `decryptEden: ${cause instanceof Error ? cause.message : String(cause)}`,
            cause,
          }),
      });
      try {
        return JSON.parse(json) as Record<string, unknown>;
      } catch (cause) {
        return yield* Effect.fail(
          new DecryptionError({
            docId,
            message: "decryptEden: decrypted blob was not valid JSON",
            cause,
          }),
        );
      }
    });

  const fetchNoteByDoc = (doc: NoteDoc): Effect.Effect<NoteRead, CouchDbError | DecryptionError> =>
    Effect.gen(function* () {
      const logical = yield* toLogicalDoc(doc);
      const chunks = yield* client.getDocs<ChunkDoc>(logical.children);
      // CouchDB returns chunks in arbitrary order; reorder by the children array.
      const byId = new Map(chunks.map((c) => [c._id, c]));
      const orderedDecrypted: string[] = [];
      for (const id of logical.children) {
        const chunk = byId.get(id);
        if (!chunk) {
          // Missing chunk — likely partial replication. Surface as empty
          // so the rest of the note is still readable.
          orderedDecrypted.push("");
          continue;
        }
        // Respect LiveSync's `e_` flag: when absent or false, the data is
        // plaintext even if it happens to start with `%`. When true, run
        // the decrypt dispatcher.
        if (chunk.e_ === true) {
          const plain = yield* decryptField(chunk.data, passphrase, pbkdf2Salt, chunk._id);
          orderedDecrypted.push(plain);
        } else {
          orderedDecrypted.push(chunk.data);
        }
      }
      const raw = assembleChunks(orderedDecrypted);
      const parsed = parseFrontmatter(raw);
      return {
        path: logical.path,
        _rev: logical._rev ?? "",
        frontmatter: parsed.frontmatter,
        body: parsed.body,
        mtime: logical.mtime,
        ctime: logical.ctime,
        size: logical.size,
      } satisfies NoteRead;
    });

  // The plugin's `_id` derivation lowercases the path before hashing
  // unless `handleFilenameCaseSensitive` is set (which is off by default
  // in LiveSync). To match what's actually in CouchDB we have to use the
  // same case-insensitive default here, otherwise `findNoteDocByPath`
  // for `Welcome.md` would compute hash("…:Welcome.md") while the doc's
  // `_id` is hash("…:welcome.md") and we'd 404 a note that exists.
  const CASE_INSENSITIVE = true;

  const findNoteDocByPath = (
    path: string,
  ): Effect.Effect<NoteDoc | undefined, CouchDbError | EncryptionError> =>
    Effect.gen(function* () {
      const id = yield* path2id(path, obfPassphrase, CASE_INSENSITIVE);
      const doc = yield* client.getDoc(id);
      if (doc && isNoteDoc(doc)) return doc;
      return undefined;
    });

  // Caller-provided "what we knew about the existing note" — distilled
  // from the LogicalDoc by `writeWithRetry`. We need `_rev` for the
  // conflict-aware put and `ctime` for creation-time preservation.
  // Reading these off the raw NoteDoc would give us the doc-level
  // (zeroed) ctime under V2 obfuscation, so update_note would silently
  // reset the original creation time on every write.
  interface ExistingNoteContext {
    readonly _rev: string | undefined;
    readonly ctime: number;
  }

  const writeChunksAndNote = (
    path: string,
    raw: string,
    existing: ExistingNoteContext | undefined,
  ): Effect.Effect<NoteRead, CouchDbError | EncryptionError | NoteConflictError> =>
    Effect.gen(function* () {
      const noteId = yield* path2id(path, obfPassphrase, CASE_INSENSITIVE);
      const plainChunks = splitIntoChunks(raw);
      // Compute deterministic chunk IDs from PRE-encryption content so
      // dedup matches what LiveSync would do client-side.
      // Pass `encrypted: true` so chunk IDs use the `h:+` prefix the
      // plugin requires for `isEncryptedChunkEntry` to fire. Plain `h:`
      // would make the plugin treat the chunk as plaintext and paste
      // our HKDF ciphertext into notes literally.
      const chunkIds = yield* Effect.tryPromise({
        try: () => Promise.all(plainChunks.map((c) => chunkId(c, true))),
        catch: (cause) =>
          new CouchDbError({ op: "chunkId", message: "failed to derive chunk ids", cause }),
      });
      const encryptedChunks = yield* Effect.all(
        plainChunks.map((c, i) =>
          encryptField(c, passphrase, pbkdf2Salt, path).pipe(
            Effect.map<string, ChunkDoc>((data) => ({
              _id: chunkIds[i] ?? `h:+${i}`,
              type: "leaf" as const,
              data,
              // The `e_: true` marker plus the `h:+` ID prefix are both
              // required: the plugin checks the prefix to decide whether
              // to even consider decryption, and `e_` to confirm.
              e_: true,
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

      const now = Date.now();
      const ctime = existing?.ctime ?? now;
      // The plugin compares this against the UTF-8 byte length of the
      // reassembled chunk content on read; if they don't match it logs
      // "File X seems to be corrupted! Writing prevented." and refuses
      // to write the file locally. `raw.length` counts UTF-16 code
      // units, which only matches byte length for pure ASCII.
      const sizeBytes = Buffer.byteLength(raw, "utf8");
      const noteDoc: NoteDoc = obfuscateOn
        ? // Obfuscated-properties path: the JSON metadata blob (path,
          // times, size, children) goes inside the encrypted `path`
          // field; the doc-level fields are zeroed. Children at the doc
          // level is `[]` so listing/sync code that scans top-level
          // fields doesn't accidentally pick up partial data.
          //
          // The inner `path` is the PLAIN vault path (no `f:` prefix).
          // The plugin's encryptMetaWithHKDF stores `getPath(doc)` which
          // resolves to the plain path; if we add `f:` here, the plugin
          // assigns it back to `doc.path` after decrypt and a later
          // `id2path_base` call recursively trips its "Entry has been
          // obfuscated!" guard (livesync-commonlib path.ts:130).
          ({
            _id: noteId,
            type: "plain" as const,
            path: yield* encryptMeta(
              {
                path,
                mtime: now,
                ctime,
                size: sizeBytes,
                children: chunkIds,
              },
              passphrase,
              pbkdf2Salt,
              path,
            ),
            children: [],
            ctime: 0,
            mtime: 0,
            size: 0,
            // Keep eden empty — we always emit content via external chunks.
            eden: {},
          } satisfies NoteDoc)
        : ({
            _id: noteId,
            type: "plain" as const,
            path,
            children: chunkIds,
            ctime,
            mtime: now,
            size: sizeBytes,
          } satisfies NoteDoc);

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

      // Parse the raw we just wrote so the response shape matches what
      // `read_note` would return (frontmatter as a structured object,
      // body as the content after the frontmatter). Keeping these
      // consistent across read and write paths is what callers expect.
      const parsed = parseFrontmatter(raw);
      return {
        path,
        _rev: result._rev,
        frontmatter: parsed.frontmatter,
        body: parsed.body,
        ctime,
        mtime: now,
        size: sizeBytes,
      } satisfies NoteRead;
    });

  // Resolve a path to the bits of state writeChunksAndNote needs:
  // current rev (for conflict-aware put) and original ctime (decrypted
  // from the meta blob, so update preserves creation time). Returns
  // undefined when the note doesn't exist.
  const existingContextFor = (
    path: string,
  ): Effect.Effect<
    ExistingNoteContext | undefined,
    CouchDbError | EncryptionError | DecryptionError
  > =>
    Effect.gen(function* () {
      const doc = yield* findNoteDocByPath(path);
      if (!doc) return undefined;
      const logical = yield* toLogicalDoc(doc);
      return { _rev: logical._rev, ctime: logical.ctime };
    });

  const writeWithRetry = (path: string, raw: string) =>
    Effect.gen(function* () {
      const existing = yield* existingContextFor(path);
      return yield* writeChunksAndNote(path, raw, existing).pipe(
        Effect.catchTag("NoteConflictError", () =>
          Effect.gen(function* () {
            const fresh = yield* existingContextFor(path);
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

    readNoteById: (id) =>
      Effect.gen(function* () {
        const doc = yield* client.getDoc(id);
        if (!doc || !isNoteDoc(doc)) {
          return yield* Effect.fail(new NoteNotFoundError({ path: `id:${id}` }));
        }
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

    editNote: (path, oldString, newString, replaceAll) =>
      Effect.gen(function* () {
        const doc = yield* findNoteDocByPath(path);
        if (!doc) return yield* Effect.fail(new NoteNotFoundError({ path }));
        const current = yield* fetchNoteByDoc(doc);
        // Count occurrences in the body — frontmatter is structured and
        // edited via `update_note`, so find/replace deliberately
        // ignores it. Using `split(old).length - 1` rather than a regex
        // to avoid surprises with special regex characters in user
        // content (e.g. literal `.*` or `[brackets]`).
        const occurrences = oldString === "" ? 0 : current.body.split(oldString).length - 1;
        if (occurrences === 0) {
          return yield* Effect.fail(
            new StringMatchError({ path, reason: "not_found", occurrences: 0 }),
          );
        }
        if (occurrences > 1 && !replaceAll) {
          return yield* Effect.fail(
            new StringMatchError({ path, reason: "ambiguous", occurrences }),
          );
        }
        const newBody = replaceAll
          ? current.body.split(oldString).join(newString)
          : current.body.replace(oldString, newString);
        const raw = formatFrontmatter(current.frontmatter, newBody);
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
        //
        // Preserve frontmatter — write the formatted raw, not just
        // body. Otherwise restore-from-trash silently loses tags,
        // dates, and any other YAML metadata.
        const trashedPath = `.trash/${path}`;
        const archivedRaw = formatFrontmatter(current.frontmatter, current.body);
        yield* writeWithRetry(trashedPath, archivedRaw);
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
 * `CouchClient` tag (resolved via Layer); reads the LiveSync sync
 * parameters at boot to pick up the master PBKDF2 salt the plugin uses
 * for HKDF, and captures the E2EE passphrase. The resulting Vault is
 * bound to a single passphrase + salt for its lifetime.
 *
 * @param passphrase The LiveSync E2EE passphrase, redacted.
 * @returns          A Layer that provides Vault and depends on CouchClient.
 */
export const VaultLayer = (passphrase: Redacted.Redacted<string>) =>
  Layer.effect(
    Vault,
    Effect.gen(function* () {
      const client = yield* CouchClient;
      const params = yield* readSyncParameters(client);
      return buildImpl(client, passphrase, params);
    }),
  );
