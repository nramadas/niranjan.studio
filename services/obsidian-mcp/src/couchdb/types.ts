// Shape of LiveSync documents in CouchDB. A faithful (but minimal) subset
// of the upstream `db.type.ts` from livesync-commonlib — only the fields
// the MCP server reads or writes. See couchdb/livesync.ts for the format
// notes.

export type EntryType = "newnote" | "plain" | "leaf";

export interface NoteDoc {
  _id: string;
  _rev?: string;
  _deleted?: boolean;
  type: "newnote" | "plain";
  /** Vault-relative path. May be encrypted (starts with `%`) when E2EE is on. */
  path: string;
  /** Chunk document IDs. Concatenated in order to reassemble the note body. */
  children: string[];
  ctime: number;
  mtime: number;
  size: number;
}

export interface ChunkDoc {
  _id: string;
  _rev?: string;
  type: "leaf";
  /** Chunk content. May be encrypted. */
  data: string;
}

export type AnyDoc = NoteDoc | ChunkDoc;

export const isNoteDoc = (d: { type?: string }): d is NoteDoc =>
  d.type === "newnote" || d.type === "plain";

export const isChunkDoc = (d: { type?: string }): d is ChunkDoc => d.type === "leaf";
