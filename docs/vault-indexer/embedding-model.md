# Embedding model: design intent and migration recipe

This document is written for **a future agent or human evaluating whether to change the vault-indexer's embedding model** — likely a swap from the in-process `bge-small-en-v1.5` default to a stronger self-hosted model or to a hosted API (OpenAI `text-embedding-3-small`/`-large`, Cohere Embed, Voyage AI). It is a self-contained document. You do not need to have read [setup.md](setup.md) first; cross-references are provided where useful.

If you are setting up the *current* (bge-small) indexer for the first time, this is the wrong document — read [setup.md](setup.md) for that. The pipeline mechanics of how embeddings flow through the indexer live in [indexing-pipeline.md](indexing-pipeline.md). How to run a side-by-side comparison lives in [evaluation.md](evaluation.md).

## 1. Why the model is behind an `Embedder` interface

The vault-indexer's `Embedder` is an Effect Context tag with three method-shaped fields:

```ts
interface EmbedderImpl {
  readonly modelName: string;
  readonly modelVersion: string;
  readonly dimensions: number;
  readonly embed: (texts: ReadonlyArray<string>) =>
    Effect.Effect<ReadonlyArray<EmbeddingVector>, EmbeddingError>;
}
```

Three implementations ship today:

- `BgeSmallEmbedderLayer` — the default. Runs `BAAI/bge-small-en-v1.5` in-process via `@huggingface/transformers` against an ONNX model file baked into the container image. 384 dimensions. Nothing leaves the user's infrastructure.
- `OpenAIEmbedderLayer` for `text-embedding-3-small` and `text-embedding-3-large` — uses the OpenAI HTTP API. Same dimensionality as bge-small (we ask OpenAI to truncate to 384) so the SQLite schema is shared.
- A `selectEmbedderLayer` selector that picks one based on the `EMBEDDER` env var.

The interface is the same property Phase 2's `AuthProvider` has: the rest of the indexer (chunker, store, query path) never sees which model is wired in. Swapping models is a layer-graph change, not an application-logic change. The `Embedder` contract — "given strings, return L2-normalised unit vectors of `dimensions`" — is enough to keep the storage, the diffing, and the KNN path identical across models.

## 2. Why `bge-small` in-process was chosen for v1

Three forces pointed at this choice, in order of importance:

**Privacy.** The vault holds personal notes. The Phase 1/2 design already keeps the bytes inside the user's own GCP project and inside one Cloudflare tunnel. Sending those bytes to a third-party embedding API for production (not eval) would silently break the property the rest of the stack works to preserve. bge-small is good enough that we don't have to pay that cost.

**Low maintenance.** The default deployment must come up with no outbound API dependency, no API key to provision, no quota to watch. ONNX weights baked into the image at build time means the indexer is offline from boot — losing internet doesn't degrade it. There is no on-call rotation around it.

**Cost.** OpenAI `text-embedding-3-small` at $0.02/1M tokens is essentially free for a personal vault (tens of thousands of chunks × hundreds of tokens = pennies per backfill). But the cost is not the dominant axis for a personal-use single-tenant deployment, and we'd rather not introduce a paid dependency we don't strictly need.

**What we ranked lower:** raw retrieval quality. bge-small is a solid model — it ranked competitively on MTEB at its size class when it was released — but `text-embedding-3-large` (3072-dim) is meaningfully better. The team accepted "competitive enough to ship simply" over "the best we could get if we paid more." The evaluation harness exists so this decision can be revisited with real evidence.

## 3. The taintedness model

Every row in `vault_chunks` carries which model produced it via the `index_meta` table (one row per `key`):

| key | value |
|---|---|
| `embedding_model` | `bge-small-en-v1.5` |
| `embedding_version` | `Xenova/bge-small-en-v1.5@quantized` |
| `embedding_dim` | `384` |

At boot, `openVectorStore` reads these three rows and compares them to what the running container's `Embedder` reports. **A mismatch fails the container with `VectorStoreSchemaError`.** Silent model mixing would corrupt the KNN ordering — a query embedded with model A scored against vectors embedded with model B is meaningless — and the failure mode would be hard to spot (rankings look superficially fine). We'd rather fail loud at boot than ship subtly wrong results.

This taintedness model is what makes a model migration **a discrete re-embed job, not a cleanup nightmare**. The recipe:

1. Decide on the new model. Run [evaluation.md](evaluation.md) §2 to confirm it's better.
2. Stop the indexer container on the VM:
   ```
   gcloud compute ssh <vm> --command 'cd /opt/obsidian && sudo docker compose stop vault-indexer'
   ```
3. Delete the on-disk store:
   ```
   gcloud compute ssh <vm> --command 'sudo rm /opt/vault-indexer/data/vectors.db'
   ```
4. Update `EMBEDDER=<new-model>` in `/opt/vault-indexer/.env` (or have `scripts/vault-indexer/deploy.sh` do it after editing its inline `.env` template).
5. If the new model has a different dimensionality, update `services/vault-indexer/src/store/schema.sql`'s `FLOAT[384]` clause to the new dim. Commit and rebuild the image. (See §5 below.)
6. Restart the indexer; `openVectorStore` writes fresh `index_meta` rows under the new model identifiers.
7. Run the backfill:
   ```
   scripts/vault-indexer/run-backfill.sh --project <id>
   ```

The whole thing takes a few minutes plus however long the new model's backfill takes. There is no schema-evolution code, no chunk-rewriting code, no partial-migration state. The store is regenerable from CouchDB, which is the source of truth.

## 4. How to run a model comparison

The evaluation harness (`scripts/vault-indexer/evaluate.sh`) backfills a per-model side-store on the VM, runs a fixed query set against each, and prints the ranked hits side-by-side. Humans are the judges; no automated metrics in v1.

```
scripts/vault-indexer/evaluate.sh --project <id> --models bge-small,openai-small
```

Read the output. For each query, look at:

- **Recall**: does the right note appear in the top 5 at all?
- **Precision**: are the hits actually relevant, or near-relevant?
- **Diversity**: hybrid mode wants the lexical and semantic arms to disagree usefully — if a stronger semantic model produces hits BM25 already finds, the marginal value is low.

A "switch worth making" result looks like: across ~20 queries, the new model puts the relevant note at position 1 in cases where the old model didn't, OR the new model's top 3 hits are visibly more on-topic than the old model's. A handful of better hits in a row isn't enough — vault queries are subjective.

See [evaluation.md](evaluation.md) for the full how-to.

## 5. Migration sketches

These are starting points, not full implementations.

### 5.1 OpenAI `text-embedding-3-small` (or `-large`)

This already exists as `OpenAIEmbedderLayer`. To move production over (not just eval):

- Populate `vault-indexer-openai-key` in Secret Manager (it has a placeholder today):
  ```
  printf '%s' '<openai key>' | gcloud secrets versions add vault-indexer-openai-key --data-file=-
  ```
- Change `EMBEDDER=bge-small` to `EMBEDDER=openai-small` (or `openai-large`) in the indexer's `.env` template inside `scripts/vault-indexer/deploy.sh`.
- Re-run the migration recipe in §3.

**Privacy caveat that matters if this ever productises:** the indexer sends note chunks to OpenAI in plaintext. For a single-user vault that's a choice between privacy and quality you can make for yourself; **for a multi-tenant productised version handling other people's data, sending their notes to a hosted API is likely not OK** without explicit per-tenant consent and a different DPA. So an eval result favouring OpenAI does not necessarily transfer to the product.

**Cost (May 2026 list):**
- `text-embedding-3-small`: $0.02 / 1M input tokens.
- `text-embedding-3-large`: $0.13 / 1M input tokens.

A 10,000-note vault with average 1000 tokens/note = 10M tokens for a full backfill. So $0.20 (small) or $1.30 (large) once, then negligible per-edit costs.

### 5.2 Stronger self-hosted: `bge-large`, `gte-large`, `nomic-embed-text-v1.5`

If you want better than bge-small without giving up privacy, the path is a bigger model still running in-process. Mechanically:

- Pick the new model's HF repo. Confirm it's available as ONNX (most popular ones are repackaged by Xenova).
- Write `BgeLargeEmbedderLayer` (or `<NewModel>EmbedderLayer`) mirroring `BgeSmallEmbedderLayer` — only the `MODEL_NAME`, `MODEL_VERSION`, `DIMENSIONS`, and the `pipeline(...)` model id change.
- Add it to `selectEmbedderLayer`'s switch.
- Bake its weights into the Dockerfile's model-fetch stage (alongside or instead of bge-small).
- Update the schema's dim if it changed (bge-large is 1024-dim).
- Run the migration recipe in §3.

**Resource implication on the e2-micro:** bge-small int8 is ~34 MB on disk and ~150 MB resident at inference. bge-large fp16 is ~670 MB on disk and ~1.2 GB resident. **bge-large will not fit on a 1 GB e2-micro alongside CouchDB.** The migration is realistically "upgrade to e2-small ($7/mo) or e2-medium first." Document the resource bump alongside the eval result that justified the model swap.

### 5.3 What changes mechanically when the model changes

| Change | What you touch |
|---|---|
| Same dimensionality, same model family | `selectEmbedderLayer` switch + a new `BgeXxxEmbedderLayer` |
| Same dimensionality, different family | as above, plus retraining intuitions about what "good" looks like in eval |
| Different dimensionality | as above, plus `services/vault-indexer/src/store/schema.sql`'s `FLOAT[384]` literal, plus a full re-embed |
| Hosted API instead of in-process | as above, plus `vault-indexer-openai-key` (or equivalent) populated in Secret Manager, plus the privacy reckoning in §5.1 |

The chunker, the queue, the store interface, the `/search` endpoint, the MCP server, the RRF fusion — none of those change. The interface is the bulkhead, and Phase 3 was structured around it for exactly that reason.
