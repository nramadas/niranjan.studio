import { Data } from "effect";

/**
 * Failure surfaced by the SQLite + sqlite-vec wrapper. Maps
 * `better-sqlite3` thrown errors (which are `SqliteError` instances with
 * cryptic `code` values like `SQLITE_BUSY`, `SQLITE_CORRUPT`,
 * `SQLITE_ERROR`) into a tagged form keyed by the operation that failed.
 *
 * @property op      The store operation that failed (`upsertChunks`,
 *                   `knn`, `deleteByPath`, `count`, `load`, `applySchema`).
 * @property code    SQLite error code when available — useful for
 *                   distinguishing "the extension didn't load" from "the
 *                   query returned the wrong shape".
 * @property message Human-readable description.
 * @property cause   The original thrown value.
 */
export class VectorStoreError extends Data.TaggedError("VectorStoreError")<{
  readonly op: string;
  readonly code?: string;
  readonly message: string;
  readonly cause?: unknown;
}> {}
