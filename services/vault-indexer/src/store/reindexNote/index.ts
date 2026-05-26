import { Vault } from "@niranjan/vault-shared/couchdb";
import * as couchdbBarrel from "@niranjan/vault-shared/couchdb";
import { Effect } from "effect";
import { chunkMarkdown } from "../../chunking/chunkMarkdown";
import type { ChunkingParameters, NoteChunk } from "../../chunking/types.ts";
import { Embedder } from "../../embedding/Embedder";
import { VectorStore } from "../VectorStore";

type NoteRead = couchdbBarrel.types.NoteRead;

export interface ReindexResult {
  readonly path: string;
  readonly noteRevision: string;
  readonly newChunks: number;
  readonly staleChunks: number;
  readonly unchangedChunks: number;
}

/**
 * The core re-index work: chunk a decrypted note, embed only the chunks
 * whose hashes are not already in the store, upsert under
 * insert-before-delete ordering. Returns a per-chunk diff summary suitable
 * for log lines.
 *
 * Decoupled from CouchDB I/O so the backfill (which already has
 * `NoteRead`s in bulk from `Vault.readAllForIndex`) doesn't re-fetch them.
 *
 * @param note    Fully decrypted note from the shared Vault.
 * @param params  Chunking knobs.
 */
export const reindexFromNote = (note: NoteRead, params: ChunkingParameters) =>
  Effect.gen(function* () {
    const embedder = yield* Embedder;
    const store = yield* VectorStore;

    const incomingChunks = chunkMarkdown(note.body, params);

    if (incomingChunks.length === 0) {
      const deleted = yield* store.deleteByPath(note.path);
      const empty: ReindexResult = {
        path: note.path,
        noteRevision: note._rev,
        newChunks: 0,
        staleChunks: deleted,
        unchangedChunks: 0,
      };
      return empty;
    }

    const prior = yield* store.listChunkHashesByPath(note.path);
    const priorHashes = new Set(prior.map((p) => p.hash));
    const newChunks = incomingChunks.filter((c) => !priorHashes.has(c.hash));
    const unchangedCount = incomingChunks.length - newChunks.length;

    const embeddings = yield* embedder.embed(newChunks.map((c) => c.text));
    if (embeddings.length !== newChunks.length) {
      yield* Effect.logError(
        `reindexFromNote(${note.path}): embedder returned ${embeddings.length} vectors for ${newChunks.length} chunks`,
      );
    }

    // Upsert payload: every incoming chunk. `upsertChunks` decides
    // per-hash whether to insert (new) or skip (already present), and
    // which prior rows to delete (no longer present).
    const upsertPayload = [
      ...newChunks.map((c: NoteChunk, i: number) => ({
        hash: c.hash,
        index: c.index,
        text: c.text,
        embedding: embeddings[i] ?? [],
      })),
      ...incomingChunks
        .filter((c) => priorHashes.has(c.hash))
        .map((c) => ({
          hash: c.hash,
          index: c.index,
          text: c.text,
          embedding: [] as ReadonlyArray<number>,
        })),
    ];

    const { inserted, deleted } = yield* store.upsertChunks(note.path, note._rev, upsertPayload);
    return {
      path: note.path,
      noteRevision: note._rev,
      newChunks: inserted,
      staleChunks: deleted,
      unchangedChunks: unchangedCount,
    } satisfies ReindexResult;
  });

/**
 * Convenience wrapper that resolves a CouchDB doc id to a `NoteRead` via
 * the shared Vault and then delegates to `reindexFromNote`. Used by the
 * changes-feed pipeline, which receives doc ids (not paths) from the
 * `_changes` stream.
 */
export const reindexNoteById = (docId: string, params: ChunkingParameters) =>
  Effect.gen(function* () {
    const vault = yield* Vault;
    const note = yield* vault.readNoteById(docId);
    return yield* reindexFromNote(note, params);
  });
