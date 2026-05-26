import { Vault, type VaultImpl } from "@niranjan/vault-shared/couchdb";
import { isIndexablePath } from "@niranjan/vault-shared/lib/isIndexablePath";
import { Effect, Layer, Ref } from "effect";
import { SearchIndex } from "../SearchIndex";
import type { SearchHit, SearchIndexImpl } from "../types.ts";

const TOKEN_RE = /[^\p{L}\p{N}]+/u;

const tokenise = (s: string): string[] =>
  s
    .toLowerCase()
    .split(TOKEN_RE)
    .filter((t) => t.length > 0);

interface Posting {
  readonly tf: number;
  readonly weighted: number;
}

interface IndexedDoc {
  readonly path: string;
  readonly title: string;
  readonly body: string;
  readonly mtime: number;
  /** Sum of weighted term frequencies (denominator material for BM25). */
  readonly weightedLen: number;
  readonly postings: ReadonlyMap<string, Posting>;
}

interface BuiltIndex {
  readonly docs: ReadonlyArray<IndexedDoc>;
  readonly inverted: ReadonlyMap<string, ReadonlyArray<number>>;
  readonly avgWeightedLen: number;
}

const indexDoc = (n: { path: string; body: string; mtime: number }): IndexedDoc => {
  const title = (n.path.split("/").pop() ?? n.path).replace(/\.md$/i, "");
  const tokens: { tok: string; weight: number }[] = [];
  for (const t of tokenise(title)) tokens.push({ tok: t, weight: 2 });
  for (const t of tokenise(n.body)) tokens.push({ tok: t, weight: 1 });
  const counts = new Map<string, number>();
  let weightedLen = 0;
  for (const { tok, weight } of tokens) {
    counts.set(tok, (counts.get(tok) ?? 0) + weight);
    weightedLen += weight;
  }
  const postings = new Map<string, Posting>();
  for (const [tok, w] of counts) {
    postings.set(tok, { tf: w, weighted: w });
  }
  return { path: n.path, title, body: n.body, mtime: n.mtime, weightedLen, postings };
};

const build = (notes: ReadonlyArray<{ path: string; body: string; mtime: number }>): BuiltIndex => {
  const docs = notes.map(indexDoc);
  const inverted = new Map<string, number[]>();
  let totalWeighted = 0;
  for (let i = 0; i < docs.length; i++) {
    const d = docs[i];
    if (!d) continue;
    totalWeighted += d.weightedLen;
    for (const tok of d.postings.keys()) {
      const arr = inverted.get(tok);
      if (arr) arr.push(i);
      else inverted.set(tok, [i]);
    }
  }
  const avgWeightedLen = docs.length > 0 ? totalWeighted / docs.length : 0;
  return { docs, inverted, avgWeightedLen };
};

const K1 = 1.5;
const B = 0.75;

const snippetFor = (body: string, queryTokens: ReadonlyArray<string>): string => {
  const window = 120;
  const lower = body.toLowerCase();
  let bestIdx = -1;
  for (const t of queryTokens) {
    const i = lower.indexOf(t);
    if (i !== -1 && (bestIdx === -1 || i < bestIdx)) bestIdx = i;
  }
  if (bestIdx === -1) return body.slice(0, window);
  const start = Math.max(0, bestIdx - 40);
  const end = Math.min(body.length, start + window);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < body.length ? "…" : "";
  return prefix + body.slice(start, end).replace(/\s+/g, " ").trim() + suffix;
};

const score = (idx: BuiltIndex, q: string, limit: number): SearchHit[] => {
  const queryTokens = Array.from(new Set(tokenise(q)));
  if (queryTokens.length === 0 || idx.docs.length === 0) return [];
  const N = idx.docs.length;

  const candidate = new Set<number>();
  for (const tok of queryTokens) {
    const ids = idx.inverted.get(tok);
    if (!ids) continue;
    for (const id of ids) candidate.add(id);
  }

  const scored: { id: number; score: number }[] = [];
  for (const id of candidate) {
    const d = idx.docs[id];
    if (!d) continue;
    let s = 0;
    for (const tok of queryTokens) {
      const posting = d.postings.get(tok);
      if (!posting) continue;
      const df = idx.inverted.get(tok)?.length ?? 0;
      const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
      const tf = posting.weighted;
      const norm = 1 - B + (B * d.weightedLen) / Math.max(1, idx.avgWeightedLen);
      s += idf * ((tf * (K1 + 1)) / (tf + K1 * norm));
    }
    if (s > 0) scored.push({ id, score: s });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map(({ id, score: hitScore }) => {
    const d = idx.docs[id];
    if (!d) {
      return { path: "", title: "", score: 0, snippet: "" };
    }
    return {
      path: d.path,
      title: d.title,
      score: Number(hitScore.toFixed(4)),
      snippet: snippetFor(d.body, queryTokens),
    };
  });
};

interface State {
  readonly index: BuiltIndex | null;
  readonly building: boolean;
  readonly dirty: boolean;
  readonly debounceTimer: NodeJS.Timeout | null;
}

const initialState: State = {
  index: null,
  building: false,
  dirty: true,
  debounceTimer: null,
};

const buildImpl = (vault: VaultImpl, debounceMs: number): Effect.Effect<SearchIndexImpl, never> =>
  Effect.gen(function* () {
    const ref = yield* Ref.make<State>(initialState);

    const rebuild = Effect.gen(function* () {
      yield* Ref.update(ref, (s) => ({ ...s, building: true, dirty: false }));
      const allNotes = yield* vault
        .readAllForIndex()
        .pipe(
          Effect.catchAll((err) =>
            Effect.logError(`search index build failed: ${String(err)}`).pipe(
              Effect.as([] as never),
            ),
          ),
        );
      // Exclude .trash/ and any other unindexable prefixes (see
      // @niranjan/vault-shared/lib/isIndexablePath). The vault-indexer
      // applies the same filter to its semantic index; without doing it
      // here too, lexical search would surface trashed duplicates that
      // semantic search has excluded — and the hybrid (RRF-fused) path
      // would still include them at a mid rank, defeating the exclusion.
      const notes = allNotes.filter((n) => isIndexablePath(n.path));
      const next = build(notes);
      yield* Ref.update(ref, (s) => ({ ...s, index: next, building: false }));
      yield* Effect.logInfo(
        `search index built: ${next.docs.length} notes (${allNotes.length - notes.length} excluded by prefix)`,
      );
    });

    const ensureBuilt: Effect.Effect<void> = Effect.gen(function* () {
      const s = yield* Ref.get(ref);
      if (s.index && !s.dirty) return;
      if (s.building) {
        yield* Effect.sleep("100 millis");
        yield* ensureBuilt;
        return;
      }
      yield* rebuild;
    });

    const markDirty = (): Effect.Effect<void> =>
      Effect.gen(function* () {
        const s = yield* Ref.get(ref);
        if (s.debounceTimer) clearTimeout(s.debounceTimer);
        const timer = setTimeout(() => {
          // Fire-and-forget: a debounced rebuild kicked off by the
          // changes feed. Errors are logged inside `rebuild`; the next
          // query will retry.
          Effect.runPromise(rebuild).catch(() => {
            /* logged in rebuild */
          });
        }, debounceMs);
        yield* Ref.set(ref, { ...s, dirty: true, debounceTimer: timer });
      });

    const query = (q: string, limit: number): Effect.Effect<ReadonlyArray<SearchHit>, never> =>
      Effect.gen(function* () {
        yield* ensureBuilt;
        const s = yield* Ref.get(ref);
        return s.index ? score(s.index, q, limit) : [];
      });

    return { query, markDirty } satisfies SearchIndexImpl;
  });

/**
 * Build the Layer that provides the `SearchIndex` tag. The index is built
 * lazily on first query and rebuilt on a debounced timer when the changes
 * feed marks it dirty. Depends on `Vault`.
 *
 * @param debounceMs How long to wait after a `markDirty` call before
 *                   rebuilding. Tunable via SEARCH_REBUILD_DEBOUNCE_MS.
 * @returns          A Layer providing SearchIndex, depending on Vault.
 */
export const SearchIndexLayer = (debounceMs: number) =>
  Layer.effect(
    SearchIndex,
    Effect.flatMap(Vault, (v) => buildImpl(v, debounceMs)),
  );
