// CouchDB client. Wraps `nano` so the rest of the codebase only sees Effect
// computations with tagged errors — `nano`'s callback/promise mix and ad
// hoc error shapes stay inside this module.
//
// Operations exposed are deliberately narrow: get a doc, put a doc with
// rev awareness, fetch a batch of chunks, list notes via _all_docs, run a
// query against a Mango index. All higher-level vault semantics live in
// `vault.ts`.

import { Context, Effect, Layer, Redacted } from "effect";
import nano from "nano";
import type { Config } from "effect";
import type { couchDbConfig } from "../config/env.js";
import { CouchDbError } from "../lib/errors.js";
import type { AnyDoc, ChunkDoc, NoteDoc } from "./types.js";

type CouchConfig = Config.Config.Success<typeof couchDbConfig>;

interface Pager {
  limit: number;
  skip?: number;
  startkey?: string;
  endkey?: string;
}

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
   * Insert or update a document. Caller MUST set `_rev` on updates; CouchDB
   * surfaces a 409 conflict otherwise. The returned doc has the new `_rev`.
   */
  readonly putDoc: <D extends { _id: string }>(
    doc: D,
  ) => Effect.Effect<D & { _rev: string }, CouchDbError>;
  /** Bulk insert/update. Same rev rules as putDoc apply per-document. */
  readonly bulkPut: <D extends { _id: string }>(
    docs: ReadonlyArray<D>,
  ) => Effect.Effect<ReadonlyArray<{ id: string; rev: string; ok: boolean }>, CouchDbError>;
  /**
   * List notes via _all_docs. We filter to documents whose `_id` does NOT
   * start with `h:` (chunks) or `_` (system) — that gives us notes only.
   * Pagination is via startkey/skip; the caller decides the strategy.
   */
  readonly listNoteDocs: (
    pager: Pager,
  ) => Effect.Effect<ReadonlyArray<NoteDoc>, CouchDbError>;
  /** Returns the underlying nano database for ops not abstracted here (changes feed). */
  readonly raw: () => nano.DocumentScope<AnyDoc>;
}

export class CouchClient extends Context.Tag("CouchClient")<CouchClient, CouchClientImpl>() {}

const wrap =
  (op: string) =>
  <T>(fn: () => Promise<T>): Effect.Effect<T, CouchDbError> =>
    Effect.tryPromise({
      try: fn,
      catch: (cause) => {
        const err = cause as { statusCode?: number; message?: string; reason?: string };
        return new CouchDbError({
          op,
          message: err.message ?? err.reason ?? String(cause),
          cause,
          ...(typeof err.statusCode === "number" ? { status: err.statusCode } : {}),
        });
      },
    });

const make = (cfg: CouchConfig): CouchClientImpl => {
  const url = new URL(cfg.url);
  url.username = cfg.username;
  url.password = encodeURIComponent(Redacted.value(cfg.password));
  const server = nano({
    url: url.toString(),
  });
  const db = server.use<AnyDoc>(cfg.database);

  return {
    getDoc: <D extends { _id: string } = AnyDoc>(id: string) =>
      wrap("getDoc")(() => db.get(id) as unknown as Promise<D>).pipe(
        Effect.catchTag("CouchDbError", (e) =>
          e.status === 404 ? Effect.succeed(undefined as D | undefined) : Effect.fail(e),
        ),
      ),

    getDocs: <D extends { _id: string } = AnyDoc>(ids: ReadonlyArray<string>) =>
      ids.length === 0
        ? Effect.succeed([] as ReadonlyArray<D>)
        : wrap("getDocs")(async () => {
            const res = await db.fetch({ keys: [...ids] });
            const out: D[] = [];
            for (const row of res.rows) {
              if ("doc" in row && row.doc) out.push(row.doc as unknown as D);
            }
            return out as ReadonlyArray<D>;
          }),

    putDoc: <D extends { _id: string }>(doc: D) =>
      wrap("putDoc")(async () => {
        const res = await db.insert(doc as unknown as AnyDoc);
        return { ...doc, _rev: res.rev };
      }),

    bulkPut: <D extends { _id: string }>(docs: ReadonlyArray<D>) =>
      wrap("bulkPut")(async () => {
        const res = await db.bulk({ docs: docs as unknown as AnyDoc[] });
        // nano types this as DocumentBulkResponse which has `id`, `rev`,
        // and `error` fields. A row is "ok" iff `error` is absent.
        return res.map((r) => ({
          id: (r as { id?: string }).id ?? "",
          rev: (r as { rev?: string }).rev ?? "",
          ok: !("error" in r) || !(r as { error?: string }).error,
        }));
      }),

    listNoteDocs: (pager) =>
      wrap("listNoteDocs")(async () => {
        const params: Record<string, unknown> = {
          include_docs: true,
          limit: pager.limit,
        };
        if (pager.skip !== undefined) params.skip = pager.skip;
        if (pager.startkey !== undefined) params.startkey = pager.startkey;
        if (pager.endkey !== undefined) params.endkey = pager.endkey;
        const res = await db.list(params as Parameters<typeof db.list>[0]);
        const docs: NoteDoc[] = [];
        for (const row of res.rows) {
          const id = row.id;
          // Skip chunks (`h:` prefix), system docs (`_`), and obfuscated-id
          // chunk-like things that aren't notes (the `type` field is the
          // authority). LiveSync also stores some `i:` internalfile docs
          // we don't surface via the MCP tools.
          if (id.startsWith("h:") || id.startsWith("_") || id.startsWith("i:")) continue;
          const doc = row.doc as unknown as { type?: string } | undefined;
          if (!doc) continue;
          if (doc.type === "newnote" || doc.type === "plain") {
            docs.push(doc as unknown as NoteDoc);
          }
        }
        return docs as ReadonlyArray<NoteDoc>;
      }),

    raw: () => db,
  };
};

export const CouchClientLayer = (cfg: CouchConfig) =>
  Layer.succeed(CouchClient, make(cfg));

export type { ChunkDoc, NoteDoc };
