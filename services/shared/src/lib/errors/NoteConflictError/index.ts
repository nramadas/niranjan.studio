import { Data } from "effect";

/**
 * Surfaced when a write loses a `_rev` race against a concurrent client
 * (or another MCP request). The Vault retries once internally; this error
 * means the second attempt also lost the race.
 *
 * @property path    The vault-relative path that couldn't be written.
 * @property message A human-readable explanation of the conflict.
 */
export class NoteConflictError extends Data.TaggedError("NoteConflictError")<{
  readonly path: string;
  readonly message: string;
}> {}
