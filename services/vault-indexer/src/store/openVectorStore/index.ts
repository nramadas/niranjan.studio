import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Effect } from "effect";
import { VectorStoreError } from "../../lib/errors/VectorStoreError";
import { VectorStoreSchemaError } from "../../lib/errors/VectorStoreSchemaError";
import type { IndexMeta, VectorStoreImpl } from "../types.ts";

interface BetterSqliteDatabaseLike {
  prepare: (sql: string) => {
    run: (...args: unknown[]) => { changes: number; lastInsertRowid: number | bigint };
    get: (...args: unknown[]) => unknown;
    all: (...args: unknown[]) => unknown[];
    pluck: (toggle?: boolean) => unknown;
  };
  exec: (sql: string) => void;
  transaction: <A extends unknown[], R>(fn: (...args: A) => R) => (...args: A) => R;
  close: () => void;
  loadExtension?: (path: string) => void;
}

interface BetterSqliteCtor {
  new (
    path: string,
    opts?: { readonly?: boolean; fileMustExist?: boolean },
  ): BetterSqliteDatabaseLike;
}

interface SqliteVecModule {
  load: (db: unknown) => void;
}

interface ExpectedMeta {
  readonly model: string;
  readonly version: string;
  readonly dim: number;
}

const tag = "openVectorStore";

const SCHEMA_PATH = resolve(dirname(fileURLToPath(import.meta.url)), "..", "schema.sql");

const readSchemaSql = (): string => {
  try {
    return readFileSync(SCHEMA_PATH, "utf8");
  } catch (cause) {
    throw new VectorStoreError({
      op: "loadSchema",
      message: `failed to read schema.sql from ${SCHEMA_PATH}: ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
      cause,
    });
  }
};

const encodeVector = (v: ReadonlyArray<number>): string => JSON.stringify(v);

/**
 * Open the SQLite file, load the sqlite-vec extension, apply the schema,
 * verify (or write) the taintedness metadata, and return a
 * `VectorStoreImpl` that uses prepared statements for every operation.
 *
 * If the file is empty (no `index_meta` rows), the expected model/version/dim
 * gets written. If the file already has a model recorded that does not
 * match the expected one, fails with `VectorStoreSchemaError` — silent
 * model mixing would corrupt the KNN ordering.
 *
 * @param sqlitePath  Absolute path to the SQLite file. Parent dir must exist.
 * @param expected    The model the running container is configured with.
 * @param vacuumOnBoot Whether to run `VACUUM` after schema apply.
 */
export const openVectorStore = (
  sqlitePath: string,
  expected: ExpectedMeta,
  vacuumOnBoot: boolean,
): Effect.Effect<VectorStoreImpl, VectorStoreError | VectorStoreSchemaError> =>
  Effect.gen(function* () {
    const Database = (yield* Effect.tryPromise({
      try: () => import("better-sqlite3"),
      catch: (cause) =>
        new VectorStoreError({
          op: tag,
          message: `failed to import better-sqlite3: ${
            cause instanceof Error ? cause.message : String(cause)
          }`,
          cause,
        }),
    })) as unknown as { default: BetterSqliteCtor };

    const sqliteVec = (yield* Effect.tryPromise({
      try: () => import("sqlite-vec"),
      catch: (cause) =>
        new VectorStoreError({
          op: tag,
          message: `failed to import sqlite-vec: ${
            cause instanceof Error ? cause.message : String(cause)
          }`,
          cause,
        }),
    })) as unknown as SqliteVecModule;

    const db = yield* Effect.try({
      try: () => new Database.default(sqlitePath),
      catch: (cause) =>
        new VectorStoreError({
          op: tag,
          message: `failed to open SQLite at ${sqlitePath}: ${
            cause instanceof Error ? cause.message : String(cause)
          }`,
          cause,
        }),
    });

    yield* Effect.try({
      try: () => sqliteVec.load(db),
      catch: (cause) =>
        new VectorStoreError({
          op: tag,
          message: `failed to load sqlite-vec extension: ${
            cause instanceof Error ? cause.message : String(cause)
          }`,
          cause,
        }),
    });

    yield* Effect.try({
      try: () => db.exec(readSchemaSql()),
      catch: (cause) =>
        new VectorStoreError({
          op: "applySchema",
          message: `failed to apply schema: ${
            cause instanceof Error ? cause.message : String(cause)
          }`,
          cause,
        }),
    });

    const readMetaRow = (key: string): string | undefined => {
      const row = db.prepare("SELECT value FROM index_meta WHERE key = ?").get(key) as
        | { value: string }
        | undefined;
      return row?.value;
    };

    const writeMetaRow = (key: string, value: string) =>
      db.prepare("INSERT OR REPLACE INTO index_meta (key, value) VALUES (?, ?)").run(key, value);

    const foundModel = readMetaRow("embedding_model");
    if (foundModel === undefined) {
      // Fresh file — record the expected model so subsequent boots
      // re-verify against it.
      writeMetaRow("embedding_model", expected.model);
      writeMetaRow("embedding_version", expected.version);
      writeMetaRow("embedding_dim", String(expected.dim));
      yield* Effect.logInfo(
        `vector store initialised: ${expected.model} v=${expected.version} dim=${expected.dim} at ${sqlitePath}`,
      );
    } else {
      const foundVersion = readMetaRow("embedding_version") ?? "";
      const foundDim = Number(readMetaRow("embedding_dim") ?? "0");
      const match =
        foundModel === expected.model &&
        foundVersion === expected.version &&
        foundDim === expected.dim;
      if (!match) {
        return yield* Effect.fail(
          new VectorStoreSchemaError({
            expected,
            found: { model: foundModel, version: foundVersion, dim: foundDim },
          }),
        );
      }
      yield* Effect.logInfo(
        `vector store opened: ${foundModel} v=${foundVersion} dim=${foundDim} at ${sqlitePath}`,
      );
    }

    if (vacuumOnBoot) {
      yield* Effect.try({
        try: () => db.exec("VACUUM"),
        catch: (cause) =>
          new VectorStoreError({
            op: "vacuum",
            message: `VACUUM failed: ${cause instanceof Error ? cause.message : String(cause)}`,
            cause,
          }),
      });
    }

    // Prepare statements once. better-sqlite3 caches the plan; reusing
    // the prepared object across calls is the recommended pattern.
    const stmtInsert = db.prepare(
      "INSERT INTO vault_chunks (embedding, note_path, chunk_hash, note_revision, chunk_index, chunk_text, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    );
    const stmtListHashesByPath = db.prepare(
      "SELECT rowid, chunk_hash AS hash FROM vault_chunks WHERE note_path = ?",
    );
    const stmtDeleteByRowid = db.prepare("DELETE FROM vault_chunks WHERE rowid = ?");
    const stmtDeleteByPath = db.prepare("DELETE FROM vault_chunks WHERE note_path = ?");
    const stmtKnn = db.prepare(
      "SELECT note_path, chunk_index, chunk_text, distance FROM vault_chunks WHERE embedding MATCH ? AND k = ? ORDER BY distance",
    );
    const stmtCount = db.prepare("SELECT count(*) AS n FROM vault_chunks");

    const wrap =
      (op: string) =>
      <T>(fn: () => T): Effect.Effect<T, VectorStoreError> =>
        Effect.try({
          try: fn,
          catch: (cause) => {
            const code = (cause as { code?: string }).code;
            return new VectorStoreError({
              op,
              ...(code ? { code } : {}),
              message: `${op} failed: ${cause instanceof Error ? cause.message : String(cause)}`,
              cause,
            });
          },
        });

    const upsertChunksTx = db.transaction(
      (
        notePath: string,
        noteRevision: string,
        chunks: ReadonlyArray<{
          hash: string;
          index: number;
          text: string;
          embedding: ReadonlyArray<number>;
        }>,
      ) => {
        const existing = stmtListHashesByPath.all(notePath) as Array<{
          rowid: number;
          hash: string;
        }>;
        const existingByHash = new Map(existing.map((r) => [r.hash, r.rowid]));
        const incomingHashes = new Set(chunks.map((c) => c.hash));

        let inserted = 0;
        const now = Date.now();
        // Insert-before-delete: every new chunk's row is in place before
        // we drop any rows that no longer apply. Concurrent KNN reads
        // during the transaction window see either the old set or the
        // new set, never a gap.
        for (const c of chunks) {
          if (existingByHash.has(c.hash)) continue;
          // BigInt for chunk_index and created_at: sqlite-vec's auxiliary
          // column type check is strict, and JS `number` binds as REAL via
          // better-sqlite3 even when the value is a whole number. The
          // schema declares both as INTEGER (see schema.sql); binding a
          // REAL fails with "Auxiliary column type mismatch". BigInt is
          // the better-sqlite3 idiom for forcing INTEGER binding.
          stmtInsert.run(
            encodeVector(c.embedding),
            notePath,
            c.hash,
            noteRevision,
            BigInt(c.index),
            c.text,
            BigInt(now),
          );
          inserted += 1;
        }

        let deleted = 0;
        for (const [hash, rowid] of existingByHash) {
          if (incomingHashes.has(hash)) continue;
          stmtDeleteByRowid.run(rowid);
          deleted += 1;
        }
        return { inserted, deleted };
      },
    );

    const impl: VectorStoreImpl = {
      upsertChunks: (notePath, noteRevision, chunks) =>
        wrap("upsertChunks")(() => upsertChunksTx(notePath, noteRevision, chunks)),

      deleteByPath: (notePath) =>
        wrap("deleteByPath")(() => stmtDeleteByPath.run(notePath).changes),

      knn: (queryVector, k) =>
        wrap("knn")(() => {
          const rows = stmtKnn.all(encodeVector(queryVector), k) as Array<{
            note_path: string;
            chunk_index: number;
            chunk_text: string;
            distance: number;
          }>;
          return rows.map((r) => ({
            notePath: r.note_path,
            chunkIndex: r.chunk_index,
            chunkText: r.chunk_text,
            distance: r.distance,
          }));
        }),

      listChunkHashesByPath: (notePath) =>
        wrap("listChunkHashesByPath")(
          () => stmtListHashesByPath.all(notePath) as Array<{ rowid: number; hash: string }>,
        ),

      count: () =>
        wrap("count")(() => {
          const row = stmtCount.get() as { n: number };
          return row.n;
        }),

      meta: () =>
        wrap("meta")(() => {
          const out: IndexMeta = {
            model: readMetaRow("embedding_model") ?? expected.model,
            version: readMetaRow("embedding_version") ?? expected.version,
            dim: Number(readMetaRow("embedding_dim") ?? expected.dim),
          };
          return out;
        }),

      close: () =>
        wrap("close")(() => {
          db.close();
        }),
    };

    return impl;
  });
