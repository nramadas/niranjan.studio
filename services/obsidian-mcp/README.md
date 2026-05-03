# obsidian-mcp

A Cloud Run service that exposes the Phase 1 Obsidian LiveSync vault to Claude over the Model Context Protocol. TypeScript with Effect.ts; ships as a Node 22 container.

For end-to-end setup (CouchDB user, OAuth signing key, Google OAuth client, deploy, connect Claude), see [../../docs/obsidian-mcp/setup.md](../../docs/obsidian-mcp/setup.md). For the architecture and trust model, see [../../docs/obsidian-mcp/architecture.md](../../docs/obsidian-mcp/architecture.md). For how the auth layer is structured (and how to swap OIDC providers), see [../../docs/obsidian-mcp/auth.md](../../docs/obsidian-mcp/auth.md). For OAuth implementation details, see [../../docs/obsidian-mcp/oauth.md](../../docs/obsidian-mcp/oauth.md).

## Layout

The codebase follows the [styleguide](../../docs/obsidian-mcp/styleguide.md): one public function per file, each in a folder named after the export, with a co-located `index.test.ts`. Module folders (`auth/`, `config/`, `couchdb/`, `lib/`, `mcp/`, `oauth/`, `search/`) are kebab-case and have an `export *` barrel `index.ts`.

- `src/main.ts` — entrypoint. Wires layers, starts the HTTP server, routes to OAuth handlers and the MCP transport.
- `src/config/` — typed env config via `effect/Config`. One folder per config (`couchDbConfig/`, `liveSyncConfig/`, `oauthConfig/`, `googleOidcConfig/`, `allowedEmailsConfig/`, `serverConfig/`, `searchConfig/`, `allConfig/`). Fails fast on missing env.
- `src/auth/` — `AuthProvider/` (Effect Context tag) and `OAuthAuthProviderLayer/`. The provider tag is the seam for swapping the auth boundary if we ever need to migrate.
- `src/oauth/` — the OAuth 2.1 + DCR + PKCE authorization server. `SigningKey/` + `SigningKeyLayer/` for the RSA-2048 signing key; `encode*`/`decode*` per token type; `verifyPkce/`, `deterministicClientId/`; `googleOidc/` sub-module for the Google OIDC integration; `handlers/` sub-module for the seven HTTP handler effects.
- `src/couchdb/` — `CouchClient/` + `CouchClientLayer/`, `Vault/` + `VaultLayer/`, `subscribeChanges/` for the `_changes` feed, and the LiveSync E2EE primitives (`encryptField/`, `decryptField/`, `path2id/`, `splitIntoChunks/`, `chunkId/`, `assembleChunks/`).
- `src/search/` — `SearchIndex/` + `SearchIndexLayer/`. In-memory BM25 over note titles (weight 2x) + bodies, rebuilt on debounced `_changes` events.
- `src/mcp/` — `buildMcpServer/`, `runTool/`, and `tools/` containing one folder per registered tool.
- `src/lib/` — `cloudRunLogger/` and `errors/` (which nests one folder per tagged error class, including `OAuthError/`).

## Local dev

```sh
npm ci
cp .env.example .env.local
# Fill in COUCHDB_*, LIVESYNC_PASSPHRASE, OAUTH_SIGNING_KEY,
# GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, ALLOWED_EMAILS.
# For local testing, generate a throwaway signing key:
#   openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048
# and paste the PEM into OAUTH_SIGNING_KEY (keep newlines, dotenv handles them).
npm run dev
```

For a one-shot smoke test that mints a local access token and POSTs `tools/list`, use `../../scripts/obsidian-mcp/test-local.sh --probe` — it sidesteps the full OAuth + Google dance for iteration speed.

## Build and deploy

The Cloud Run service is rolled by `../../scripts/obsidian-mcp/deploy.sh` — it builds a Docker image, tags it with the git short-SHA, pushes to Artifact Registry, and updates the service revision.
