import { Context, type Effect } from "effect";
import type nano from "nano";
import { CouchDbError } from "../../lib/errors/CouchDbError";
import type { AnyDoc, NoteDoc } from "../types.ts";

interface Pager {
  limit: number;
  skip?: number;
  startkey?: string;
  endkey?: string;
}

/**
 * The shape of the CouchDB client. Operations are deliberately narrow:
 * read a doc, write a doc with rev awareness, fetch a batch, list notes,
 * expose the raw nano scope for the changes feed. Higher-level vault
 * semantics (chunk reassembly, encryption, conflict retries) live in
 * `Vault`, not here.
 */
export interface CouchClientImpl {
  /** Read a single document by id. Returns undefined for 404. */
  readonly getDoc: <D extends { _id: string } = AnyDoc>(
    id: string,
  ) => Effect.Effect<D | undefined, CouchDbError>;
  /** Bulk-read documents by id. Missing IDs are silently dropped. */
  readonly getDocs: <D extends { _id: string } = AnyDoc>(
    ids: ReadonlyArray<string>,
  ) => Effect.Effect<ReadonlyArray<D>, CouchDbError>;
  /**
   * Insert or update a document. Caller MUST set `_rev` on updates;
   * CouchDB surfaces a 409 conflict otherwise. The returned doc has the
   * new `_rev`.
   */
  readonly putDoc: <D extends { _id: string }>(
    doc: D,
  ) => Effect.Effect<D & { _rev: string }, CouchDbError>;
  /** Bulk insert/update. Same rev rules as `putDoc` apply per-document. */
  readonly bulkPut: <D extends { _id: string }>(
    docs: ReadonlyArray<D>,
  ) => Effect.Effect<ReadonlyArray<{ id: string; rev: string; ok: boolean }>, CouchDbError>;
  /**
   * List notes via `_all_docs` (filtered to documents whose `_id` does
   * NOT start with `h:` chunks or `_` system docs). Pagination strategy
   * is the caller's choice via the pager.
   */
  readonly listNoteDocs: (pager: Pager) => Effect.Effect<ReadonlyArray<NoteDoc>, CouchDbError>;
  /** Returns the underlying nano scope for ops not abstracted here (changes feed). */
  readonly raw: () => nano.DocumentScope<AnyDoc>;
}

/**
 * The CouchClient Effect Context tag. Wired in at boot by
 * `CouchClientLayer`; consumers pull it via Effect.gen.
 */
export class CouchClient extends Context.Tag("CouchClient")<CouchClient, CouchClientImpl>() {}
