import type { StoredChunkRef } from "../types.ts";

export interface DiffInput<C> {
  readonly priorRefs: ReadonlyArray<StoredChunkRef>;
  readonly incomingChunks: ReadonlyArray<C>;
}

export interface DiffOutput<C> {
  /** New chunks to embed + insert. */
  readonly toEmbed: ReadonlyArray<C>;
  /** Existing rowids that are no longer present and should be deleted after insert. */
  readonly toDeleteRowids: ReadonlyArray<number>;
  /** Existing rowids that survive (no work needed). */
  readonly unchangedRowids: ReadonlyArray<number>;
}

/**
 * Content-addressed diff for a note's chunk set. Given the existing
 * (hash, rowid) refs on disk and the just-computed chunks, partition
 * the work into three buckets: re-embed only the chunks whose hashes
 * are genuinely new, leave unchanged chunks alone, drop chunks whose
 * hashes are no longer present.
 *
 * This is the property that makes a one-paragraph edit re-embed
 * roughly one chunk, not the whole note. The caller (`reindexNote`)
 * enforces insert-before-delete ordering using the returned partitions.
 *
 * Generic over the incoming chunk shape so the function is reusable
 * for tests that don't carry full embeddings.
 *
 * @param input  Existing refs + incoming chunks.
 * @param hashOf Extractor for the incoming chunk's hash.
 * @returns      Three disjoint sets covering the union of hashes.
 */
export const diffChunks = <C>(input: DiffInput<C>, hashOf: (c: C) => string): DiffOutput<C> => {
  const priorByHash = new Map<string, number>();
  for (const r of input.priorRefs) priorByHash.set(r.hash, r.rowid);

  const incomingHashes = new Set<string>();
  const toEmbed: C[] = [];
  for (const c of input.incomingChunks) {
    const h = hashOf(c);
    incomingHashes.add(h);
    if (!priorByHash.has(h)) toEmbed.push(c);
  }

  const toDeleteRowids: number[] = [];
  const unchangedRowids: number[] = [];
  for (const [hash, rowid] of priorByHash) {
    if (incomingHashes.has(hash)) unchangedRowids.push(rowid);
    else toDeleteRowids.push(rowid);
  }

  return { toEmbed, toDeleteRowids, unchangedRowids };
};
