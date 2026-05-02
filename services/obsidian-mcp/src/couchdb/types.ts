// Document and result types used across the couchdb module. These are
// reused by multiple function-folders (CouchClient, Vault, isNoteDoc,
// isChunkDoc), so they live at the module level per the styleguide.

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

export interface ParsedFrontmatter {
  readonly frontmatter: Record<string, unknown>;
  readonly body: string;
}

export interface NoteRead {
  readonly path: string;
  readonly _rev: string;
  readonly frontmatter: Record<string, unknown>;
  readonly body: string;
  readonly mtime: number;
  readonly ctime: number;
  readonly size: number;
}

export interface NoteSummary {
  readonly path: string;
  readonly title: string;
  readonly mtime: number;
  readonly size: number;
}

export interface ChangeEvent {
  readonly id: string;
  readonly seq: string | number;
  readonly deleted?: boolean;
}
