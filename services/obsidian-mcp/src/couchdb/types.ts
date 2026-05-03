// Document and result types used across the couchdb module. These are
// reused by multiple function-folders (CouchClient, Vault, isNoteDoc,
// isChunkDoc), so they live at the module level per the styleguide.

export type EntryType = "newnote" | "plain" | "leaf";

export interface NoteDoc {
  _id: string;
  _rev?: string;
  _deleted?: boolean;
  type: "newnote" | "plain";
  /**
   * When path obfuscation is on, this is `"/\\:" + HKDF-encrypted JSON of
   * `{ path, mtime, ctime, size, children }`. The doc-level `mtime`,
   * `ctime`, `size`, and `children` are deliberately zeroed/empty in that
   * case; the real values live inside the encrypted blob. When obfuscation
   * is off, this is the plaintext vault path.
   */
  path: string;
  /**
   * Chunk document IDs in order. EMPTY when path obfuscation is on — the
   * real list is inside the encrypted `path` blob. Always read via
   * `decryptMeta` when obfuscation is on.
   */
  children: string[];
  ctime: number;
  mtime: number;
  size: number;
  /**
   * Inline storage for small notes. When non-empty AND HKDF-encrypted,
   * `eden["h:++encrypted-hkdf"].data` holds the HKDF ciphertext of
   * `JSON.stringify(originalEden)`.
   */
  eden?: Record<string, { data: string; epoch?: number } | unknown>;
}

export interface ChunkDoc {
  _id: string;
  _rev?: string;
  type: "leaf";
  /** Chunk content. May be encrypted (`%=` HKDF or `%$` ephemeral). */
  data: string;
  /**
   * LiveSync's encrypted-marker flag. `true` means `data` is ciphertext;
   * absent/false means `data` is plaintext. Decrypt logic respects this so
   * a chunk with `%`-prefixed plaintext (rare but possible) isn't mistaken
   * for ciphertext.
   */
  e_?: boolean;
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
