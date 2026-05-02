# obsidian-mcp

A Cloud Run service that exposes the Phase 1 Obsidian LiveSync vault to Claude over the Model Context Protocol. TypeScript with Effect.ts; ships as a Node 22 container.

For end-to-end setup (CouchDB user, Cloudflare Access, deploy, connect Claude), see [../../docs/obsidian-mcp/setup.md](../../docs/obsidian-mcp/setup.md). For the architecture and trust model, see [../../docs/obsidian-mcp/architecture.md](../../docs/obsidian-mcp/architecture.md). For how the auth layer is structured (and how to swap providers later), see [../../docs/obsidian-mcp/auth.md](../../docs/obsidian-mcp/auth.md).

## Layout

The codebase follows the [styleguide](../../docs/obsidian-mcp/styleguide.md): one public function per file, each in a folder named after the export, with a co-located `index.test.ts`. Module folders (`auth/`, `config/`, `couchdb/`, `lib/`, `mcp/`, `search/`) are kebab-case and have an `export *` barrel `index.ts`.

- `src/main.ts` — entrypoint. Wires layers, starts the HTTP server.
- `src/config/` — typed env config via `effect/Config`. One folder per config (`couchDbConfig/`, `liveSyncConfig/`, `cloudflareAccessConfig/`, `authConfig/`, `serverConfig/`, `searchConfig/`, `allConfig/`). Fails fast.
- `src/auth/` — `AuthProvider/` (Effect Context tag), `CloudflareAccessAuthProviderLayer/`, `DisabledAuthProviderLayer/`, `verifyBearerToken/`, `types.ts`. The provider boundary is the seam for migrating to IAP / OIDC later.
- `src/couchdb/` — `CouchClient/` + `CouchClientLayer/`, `Vault/` + `VaultLayer/`, `subscribeChanges/` for the `_changes` feed, and the LiveSync E2EE primitives (`encryptField/`, `decryptField/`, `path2id/`, `splitIntoChunks/`, `chunkId/`, `assembleChunks/`).
- `src/search/` — `SearchIndex/` + `SearchIndexLayer/`. In-memory BM25 over note titles (weight 2x) + bodies, rebuilt on debounced `_changes` events.
- `src/mcp/` — `buildMcpServer/`, `runTool/`, and `tools/` containing one folder per registered tool.
- `src/lib/` — `cloudRunLogger/` and `errors/` (which nests one folder per tagged error class).

## Local dev

```sh
npm ci
cp .env.example .env.local
# Fill in COUCHDB_*, LIVESYNC_PASSPHRASE, MCP_BEARER_TOKEN at minimum.
npm run dev
```

`AUTH_PROVIDER=disabled` skips the Cloudflare Access JWT check (the bearer-token check still runs). For a one-shot smoke test against the running server, use `../../scripts/obsidian-mcp/test-local.sh`.

## Build and deploy

The Cloud Run service is rolled by `../../scripts/obsidian-mcp/deploy.sh` — it builds a Docker image, tags it with the git short-SHA, pushes to Artifact Registry, and updates the service revision.
