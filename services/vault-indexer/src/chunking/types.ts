// Shared types for the markdown chunker.

/**
 * A single chunk produced by `chunkMarkdown`. The `hash` is a stable
 * content-addressed identifier (truncated sha256 of the chunk text) —
 * the store's diff logic uses it to decide which chunks to re-embed
 * after a note edit.
 */
export interface NoteChunk {
  /** Zero-based position within the note's chunk list. */
  readonly index: number;
  /** The chunk text, including any header/paragraph boundaries inside it. */
  readonly text: string;
  /** Truncated sha256 hex of `text`. */
  readonly hash: string;
  /** Inclusive byte offset of `text[0]` in the source body. */
  readonly charStart: number;
  /** Exclusive byte offset of the chunk's end in the source body. */
  readonly charEnd: number;
}

/**
 * Tuning knobs accepted by `chunkMarkdown`. Token counts are estimates
 * — see `tokenEstimate`.
 */
export interface ChunkingParameters {
  readonly target: number;
  readonly overlap: number;
  readonly min: number;
}
