import { Effect, Layer, Redacted, type Config } from "effect";
import nano from "nano";
import { CouchDbError } from "../../lib/errors/CouchDbError";
import { couchDbConfig } from "../../config/couchDbConfig";
import { CouchClient, type CouchClientImpl } from "../CouchClient";
import type { AnyDoc, NoteDoc } from "../types.ts";

type CouchConfig = Config.Config.Success<typeof couchDbConfig>;

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

const buildImpl = (cfg: CouchConfig): CouchClientImpl => {
  const url = new URL(cfg.url);
  url.username = cfg.username;
  url.password = encodeURIComponent(Redacted.value(cfg.password));
  const server = nano({ url: url.toString() });
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
          // Skip chunks (`h:` prefix), system docs (`_`), and internal
          // file docs (`i:`) which we don't surface via MCP tools. The
          // `type` field is the authority — `_id` prefix is a fast filter.
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

/**
 * Build the Layer that provides the `CouchClient` tag, given resolved
 * CouchDB config. The Layer constructs a single `nano` server scoped to
 * the configured database and wraps every operation in tagged Effect
 * errors so the rest of the codebase never has to touch `nano` directly.
 *
 * @param cfg The resolved CouchDB config (URL, database, username, redacted password).
 * @returns   A Layer providing the CouchClient tag.
 */
export const CouchClientLayer = (cfg: CouchConfig) =>
  Layer.succeed(CouchClient, buildImpl(cfg));
