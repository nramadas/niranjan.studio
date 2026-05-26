import { createHash } from "node:crypto";

/**
 * Content-addressed identifier for a chunk: the first 16 hex chars of
 * the sha256 digest of the chunk's text. 64 bits is collision-safe at
 * the vault-indexer scale (a personal vault is tens of thousands of
 * chunks at most), and the truncation keeps the SQLite metadata column
 * narrow without losing meaningful uniqueness.
 *
 * @param s The chunk text to hash.
 * @returns 16-character lowercase hex string.
 */
export const sha256Hash = (s: string): string =>
  createHash("sha256").update(s, "utf8").digest("hex").slice(0, 16);
