import type { NoteDoc } from "../types.ts";

/**
 * Type guard: narrows an arbitrary CouchDB document to a NoteDoc by
 * checking the `type` field. Used wherever we can't statically guarantee
 * we're holding a note (most commonly when reading from `_all_docs` or
 * the changes feed).
 */
export const isNoteDoc = (d: { type?: string }): d is NoteDoc =>
  d.type === "newnote" || d.type === "plain";
