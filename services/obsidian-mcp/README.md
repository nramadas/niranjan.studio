# obsidian-mcp

A Cloud Run service that exposes the Phase 1 Obsidian LiveSync vault to Claude over the Model Context Protocol. TypeScript with Effect.ts; ships as a Node 22 container.

For end-to-end setup (CouchDB user, Cloudflare Access, deploy, connect Claude), see [../../docs/obsidian-mcp/setup.md](../../docs/obsidian-mcp/setup.md). For the architecture and trust model, see [../../docs/obsidian-mcp/architecture.md](../../docs/obsidian-mcp/architecture.md). For how the auth layer is structured (and how to swap providers later), see [../../docs/obsidian-mcp/auth.md](../../docs/obsidian-mcp/auth.md).

## Layout

- `src/main.ts` — entrypoint. Wires layers, starts the HTTP server.
- `src/config/env.ts` — typed env config via `effect/Config`. Fails fast.
- `src/auth/` — `AuthProvider` interface + `CloudflareAccessAuthProvider` impl. The provider boundary is the seam for migrating to IAP / OIDC later.
- `src/couchdb/` — nano-based client wrapped in Effect, the `_changes` feed subscription, and the LiveSync E2EE encode/decode layer.
- `src/search/` — in-memory BM25 index over note titles + bodies, rebuilt on debounced changes.
- `src/mcp/` — MCP server and one file per tool.

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
