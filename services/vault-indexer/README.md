# vault-indexer

Always-on indexer for the Obsidian vault. Runs in a container on the same e2-micro VM as CouchDB; subscribes to the CouchDB `_changes` feed; decrypts notes through the LiveSync E2EE codec; chunks them; embeds each chunk in-process via `bge-small-en-v1.5`; and stores the resulting 384-dim vectors in a `sqlite-vec` file on disk. Exposes one private HTTP endpoint, `POST /search`, called only by the Cloud Run obsidian-mcp service through a Cloudflare Access-gated tunnel route.

For the end-to-end picture see [docs/vault-indexer/architecture.md](../../docs/vault-indexer/architecture.md). For why this lives next to CouchDB and not in the MCP server, see [docs/vault-indexer/architecture.md](../../docs/vault-indexer/architecture.md) §1.

## Why it's a separate process

`sqlite-vec` is a file-based SQLite extension, not a server. Whatever touches the vector file has to live on the same host as the file. The Cloud Run MCP service is stateless and scales to zero, so it cannot hold the file. The indexer owns:

- the CouchDB `_changes` subscription (persistent connection, reconnects with backoff)
- the embedder (model weights baked into the image)
- the SQLite file (single writer; `better-sqlite3` is synchronous and avoids the lock-contention class of bugs you get with async wrappers)
- the chunk diffing (content-addressed: a paragraph edit re-embeds only the affected chunks)
- the backfill entrypoint (separate file, run via `docker compose run --rm`)

## Local development

```
pnpm install                # at repo root
cp .env.example .env.local  # fill in COUCHDB_*, LIVESYNC_PASSPHRASE, SEARCH_BEARER_TOKEN
pnpm dev                    # tsx watch src/main.ts
```

`tsx` resolves the workspace `@niranjan/vault-shared` dependency from source; no build step needed for dev.

## Layout

Follows [docs/obsidian-mcp/styleguide.md](../../docs/obsidian-mcp/styleguide.md) verbatim: one public function per file, function/class folders mirror the export's case, module folders are kebab-case, barrels use `export *` for sibling function-folders and `export * as foo` for sub-modules and module-level `types.ts`/`constants.ts`.

```
src/
├── main.ts                  # long-running entrypoint
├── backfill.ts              # one-shot initial backfill
├── eval.ts                  # evaluation harness entrypoint
├── config/                  # Effect Config modules (one per area)
├── embedding/               # Embedder interface + impls (bge-small default; OpenAI small/large for eval)
├── chunking/                # markdown-aware chunker + token estimator
├── store/                   # sqlite-vec read/write + content-addressed diffing
├── changes/                 # _changes subscription, per-doc-id debounced queue
├── search/                  # query → embed → KNN → ranked hits
├── http/                    # private /search + /health endpoints
└── lib/                     # service-local helpers (tagged errors only; logger lives in shared)
```
