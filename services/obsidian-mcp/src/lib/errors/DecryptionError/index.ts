import { Data } from "effect";

/**
 * Surfaced when LiveSync E2EE decryption fails. The most common cause is
 * a passphrase mismatch between the LiveSync plugin and the
 * `obsidian-livesync-passphrase` Secret Manager value; less commonly,
 * a chunk or path was encrypted with a format the server doesn't handle
 * (e.g. HKDF fixed-salt).
 *
 * @property docId   The CouchDB document `_id` whose field failed to
 *                   decrypt. Useful for grepping CouchDB to investigate.
 * @property message Detail from the underlying crypto library.
 * @property cause   The original thrown value, kept for debugging.
 */
export class DecryptionError extends Data.TaggedError("DecryptionError")<{
  readonly docId: string;
  readonly message: string;
  readonly cause?: unknown;
}> {}
