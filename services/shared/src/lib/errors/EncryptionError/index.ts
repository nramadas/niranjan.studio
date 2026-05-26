import { Data } from "effect";

/**
 * Surfaced when LiveSync E2EE encryption fails on a write path. Almost
 * always indicates a misconfigured passphrase secret; the actual
 * `octagonal-wheels` encryption call is otherwise infallible for
 * well-formed inputs.
 *
 * @property path    The vault-relative path being written.
 * @property message Detail from the underlying crypto library.
 * @property cause   The original thrown value, kept for debugging.
 */
export class EncryptionError extends Data.TaggedError("EncryptionError")<{
  readonly path: string;
  readonly message: string;
  readonly cause?: unknown;
}> {}
