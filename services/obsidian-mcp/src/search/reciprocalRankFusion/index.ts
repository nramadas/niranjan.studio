/**
 * One ranked list of items with arbitrary id, fed into RRF.
 * The `id` is whatever uniquely identifies a result for the purpose
 * of fusion — typically the note path. Items appearing under the
 * same `id` in two lists are treated as the same result and their
 * ranks are summed.
 */
export interface RankedList<T> {
  readonly id: string;
  readonly value: T;
}

export interface FusedHit<T> {
  readonly id: string;
  readonly score: number;
  /** First-encountered value (deduplicated across input lists). */
  readonly value: T;
}

/**
 * Reciprocal Rank Fusion. Given N ranked lists, compute a combined
 * score per unique item id: `Σ_i 1 / (k + rank_i)`, where `rank_i`
 * is the item's 1-based position in list i and items absent from a
 * list contribute zero.
 *
 * The constant `k` (default 60) is the value introduced by Cormack,
 * Clarke & Buettcher (SIGIR 2009). The denominator `(k + rank)`
 * dampens the influence of items appearing only deep in one list
 * while letting items appearing near the top of any list rise.
 * Smaller k makes top hits dominate more aggressively; larger k
 * flattens the contribution curve. 60 is the empirically-stable
 * middle ground and the value most implementations use.
 *
 * The first list to mention an item wins the `value` field for that
 * id — useful when one list carries richer metadata (BM25 carries
 * `snippet`, semantic carries `chunkText`).
 *
 * @param lists Two or more ranked lists. Order within each list is
 *              the rank; index 0 is rank 1.
 * @param k     RRF dampening constant. Default 60.
 * @returns     One entry per unique id, sorted by descending score.
 */
export const reciprocalRankFusion = <T>(
  lists: ReadonlyArray<ReadonlyArray<RankedList<T>>>,
  k = 60,
): ReadonlyArray<FusedHit<T>> => {
  const aggregate = new Map<string, { score: number; value: T }>();
  for (const list of lists) {
    for (let i = 0; i < list.length; i++) {
      const entry = list[i];
      if (!entry) continue;
      const rank = i + 1;
      const contribution = 1 / (k + rank);
      const prior = aggregate.get(entry.id);
      if (prior) {
        aggregate.set(entry.id, { score: prior.score + contribution, value: prior.value });
      } else {
        aggregate.set(entry.id, { score: contribution, value: entry.value });
      }
    }
  }
  const fused: FusedHit<T>[] = [];
  for (const [id, { score, value }] of aggregate) {
    fused.push({ id, score, value });
  }
  fused.sort((a, b) => b.score - a.score);
  return fused;
};
