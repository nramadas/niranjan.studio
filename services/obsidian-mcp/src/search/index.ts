// In-memory BM25 search index over note titles + bodies.
//
// - Title weight 2x, body weight 1x.
// - Whitespace + punctuation tokenisation, lowercase, no stemming. Stemming
//   (and stop-word lists) trade recall for precision; for a personal vault
//   where the user remembers the rough word they wrote, recall wins.
// - Index built lazily on first query, rebuilt on a debounced timer when
//   the changes feed reports updates (default 5s — see config.search).
// - Map-based postings, no Elasticsearch, no external services.
//
// BM25 constants k1=1.5, b=0.75 are the textbook defaults; tune later if
// search quality is bad in practice.

import { Context, Effect, Layer, Ref } from "effect";
import { Vault, type VaultImpl } from "../couchdb/vault.js";

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

export interface SearchHit {
  readonly path: string;
  readonly title: string;
  readonly score: number;
  readonly snippet: string;
}

export interface SearchIndexImpl {
  readonly query: (q: string, limit: number) => Effect.Effect<ReadonlyArray<SearchHit>, never>;
  readonly markDirty: () => Effect.Effect<void>;
}

export class SearchIndex extends Context.Tag("SearchIndex")<SearchIndex, SearchIndexImpl>() {}

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
  return scored.slice(0, limit).map(({ id, score }) => {
    const d = idx.docs[id];
    if (!d) {
      return { path: "", title: "", score: 0, snippet: "" };
    }
    return {
      path: d.path,
      title: d.title,
      score: Number(score.toFixed(4)),
      snippet: snippetFor(d.body, queryTokens),
    };
  });
};

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

const make = (vault: VaultImpl, debounceMs: number): Effect.Effect<SearchIndexImpl, never> =>
  Effect.gen(function* () {
    const ref = yield* Ref.make<State>(initialState);

    const rebuild = Effect.gen(function* () {
      yield* Ref.update(ref, (s) => ({ ...s, building: true, dirty: false }));
      const notes = yield* vault.readAllForIndex().pipe(
        Effect.catchAll((err) =>
          Effect.logError(`search index build failed: ${String(err)}`).pipe(
            Effect.as([] as never),
          ),
        ),
      );
      const next = build(notes);
      yield* Ref.update(ref, (s) => ({ ...s, index: next, building: false }));
      yield* Effect.logInfo(`search index built: ${next.docs.length} notes`);
    });

    const ensureBuilt: Effect.Effect<void> = Effect.gen(function* () {
      const s = yield* Ref.get(ref);
      if (s.index && !s.dirty) return;
      if (s.building) {
        // Spin while another fiber builds.
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
          // changes feed. We swallow errors here because they're already
          // logged inside rebuild; the next query will rebuild again.
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

export const SearchIndexLayer = (debounceMs: number) =>
  Layer.effect(
    SearchIndex,
    Effect.flatMap(Vault, (v) => make(v, debounceMs)),
  );
