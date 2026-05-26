# Evaluation harness

How to use `scripts/vault-indexer/evaluate.sh` to compare embedding models on your actual vault. The judgment is human; the harness only sets up the comparison.

## Mental model

You will not get a single number that says "model X is 12% better than model Y." Retrieval quality on a personal vault is too subjective for that. What you'll get is **side-by-side ranked output per query**, and you'll read it like a code review — comparing what's at the top, what's missed, what's a surprise.

The harness:

1. Spins up the indexer container in one-shot mode (`docker compose run --rm`).
2. For each model in `--models`, opens a per-model side-store at `/opt/vault-indexer/data/vectors.db.eval-<model>.db` (so the prod store is untouched).
3. Backfills the side-store: walks every note via `Vault.readAllForIndex`, chunks, embeds with the chosen model, upserts.
4. Runs each query through `semanticSearch` against the side-store, capturing the top-K hits.
5. After all models are done, prints one block per query with each model's hits as a side-by-side column.
6. Removes the side-stores.

A run with 2 models, ~1000 notes per model, ~20 queries takes roughly 8–10 minutes on the e2-micro for bge-small + bge-small, or ~5 minutes when one arm is OpenAI (network-bound but no local CPU cost).

## Query set

Queries live in the image at `/opt/vault-indexer/eval/queries.txt`. The file is part of the source tree at `services/vault-indexer/eval/queries.txt` and gets baked into the container at build time.

Format: one query per line; lines starting with `#` are comments.

```
how do I configure cloudflared on the VM
oauth signing key rotation procedure
LiveSync passphrase recovery
...
recipe for sourdough bread
```

The set the repo ships with is a starting point. **Replace and extend it for your vault.** The most useful queries are:

- **Things you actually search for.** Recent things, recurring things, things you wrote a note about and can't find again.
- **Things with no obvious keyword overlap with the relevant note.** This is where semantic search is supposed to win. "the long-running effects pattern I figured out last week" should find a note titled `ts-effect-supervision.md` whose body says "managed runtime with forked daemon" — different vocabulary, same meaning.
- **Things that should NOT match anything in your vault.** Test for false positives. A query like "recipe for sourdough bread" against a vault of code notes should return either nothing or visibly low scores. A model that confidently surfaces unrelated notes for unrelated queries is a model with a calibration problem.

Edit the file at `services/vault-indexer/eval/queries.txt`, rebuild the image (`scripts/vault-indexer/deploy.sh`), then run `evaluate.sh`.

## Running a comparison

The default is `bge-small,openai-small`:

```
scripts/vault-indexer/evaluate.sh --project <id>
```

To compare three models in one run:

```
scripts/vault-indexer/evaluate.sh --project <id> --models bge-small,openai-small,openai-large
```

OpenAI models require `vault-indexer-openai-key` to be populated. Without it the OpenAI arms will fail with `EmbeddingError: OPENAI_API_KEY required`. That's by design — the harness exits clearly rather than silently skipping.

## Reading the output

Each query gets a block:

```
========================================
QUERY: how do I configure cloudflared on the VM
----------------------------------------

[bge-small]
  1. (0.732) docs/obsidian/tunnel-setup.md
     Manual cloudflared steps for the obsidian VM. After cloudflared tunnel login, …
  2. (0.694) scripts/obsidian/setup-tunnel.sh
     #!/usr/bin/env bash The one-time tunnel bootstrap script. Runs cloudflared tunnel …
  3. (0.531) docs/runbook.md
     … recover the tunnel UUID by SSHing in and reading ~/.cloudflared/config.yml …

[openai-small]
  1. (0.812) docs/obsidian/tunnel-setup.md
     Manual cloudflared steps for the obsidian VM. After cloudflared tunnel login, …
  2. (0.787) scripts/obsidian/setup-tunnel.sh
     #!/usr/bin/env bash The one-time tunnel bootstrap script. Runs cloudflared tunnel …
  3. (0.733) docs/obsidian-mcp/setup.md
     … with the indexer subdomain routed through the same tunnel. cloudflared config …
```

Read across:

- **Same top hit, same #2?** Models agree. Probably no migration value for this query.
- **One model surfaces a hit the other misses?** Worth investigating. Is the missed hit actually relevant? Sometimes the "winner" is just confident about a tangent.
- **One model puts a clearly-irrelevant hit at #1?** That's a calibration smell. Try a few more queries before drawing conclusions.

Scores between models are **not directly comparable** — they live in different vector spaces with different magnitudes. Compare *rankings*, not absolute scores.

## When the result justifies a switch

You'd switch from bge-small to a stronger model when, across a query set you trust:

- The stronger model puts the truly-relevant note at position 1 in cases where bge-small didn't.
- The stronger model produces visibly better #1–#3 hits on **multiple** subjective queries.
- The patterns are consistent across queries, not one-off.

A single dramatic difference on a single query is not a signal — it's noise. Expand the query set, run the harness twice, and look for systematic improvement before changing prod.

If the result does justify a switch, follow the migration recipe in [embedding-model.md](embedding-model.md) §3.

## Limitations

- **The harness uses semantic-only ranking** for the comparison. It does not run the production RRF fusion, because the BM25 arm is model-independent (same scores regardless of which embedder is wired in) and would just add noise to the comparison.
- **No automated metrics in v1.** No NDCG, no MRR, no human-labeled ground truth. The judgment is the user's. If you want NDCG, label a held-out set of (query, expected note path) pairs and extend `eval.ts` to compute it; the harness output format is structured enough to parse.
- **Side-stores are full backfills.** A single eval run is two-to-three full backfills under different models. On a large vault that's slow. For iterative experimentation, consider building a sampled query set against a subset of notes — patch the harness to truncate `Vault.readAllForIndex` for eval runs.
