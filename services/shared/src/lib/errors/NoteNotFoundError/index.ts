import { Data } from "effect";

/**
 * Surfaced when a tool tries to read or modify a note at a path that
 * doesn't exist in the vault.
 *
 * @property path The vault-relative path the caller supplied.
 */
export class NoteNotFoundError extends Data.TaggedError("NoteNotFoundError")<{
  readonly path: string;
}> {}
