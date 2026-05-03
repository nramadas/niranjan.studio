# Architecture

## Request flow

```mermaid
sequenceDiagram
    participant C as Claude (web / iPad / iPhone)
    participant CFE as Cloudflare Edge<br/>(DNS only)
    participant GFE as Google Frontend
    participant S as Cloud Run<br/>(obsidian-mcp)
    participant SM as Secret Manager
    participant G as accounts.google.com
    participant DB as CouchDB<br/>(localhost:5984 on e2-micro)

    Note over C,S: First-time setup: OAuth flow
    C->>CFE: DNS lookup mcp.&lt;domain&gt;
    CFE-->>C: CNAME → ghs.googlehosted.com
    C->>GFE: GET /.well-known/oauth-authorization-server
    GFE->>S: forwarded
    S-->>C: { authorize, token, register, jwks_uri }
    C->>S: POST /register (DCR)
    S-->>C: client_id (deterministic hash)
    C->>S: GET /authorize?code_challenge=...
    S-->>C: 302 → accounts.google.com (state=signed JWT)
    C->>G: sign in with email
    G-->>C: 302 → /oauth/google/callback?code=...&state=...
    C->>S: GET /oauth/google/callback?code=...
    S->>G: POST /token (exchange code for id_token)
    G-->>S: id_token
    S->>S: verify id_token + email allow-list
    S-->>C: 302 → claude redirect_uri?code=&lt;jwt&gt;
    C->>S: POST /token (auth code + PKCE verifier)
    S-->>C: { access_token, refresh_token }

    Note over C,S: Subsequent MCP requests
    C->>S: POST /mcp Authorization: Bearer &lt;access_token&gt;
    S->>S: verify access_token signature + claims
    S->>SM: read LiveSync passphrase (cached after first read)
    S->>DB: GET /obsidian/&lt;note-id&gt; via vault.&lt;domain&gt; tunnel
    DB-->>S: encrypted note doc + chunks
    S->>S: assemble + decrypt with passphrase
    S-->>C: JSON-RPC tool result
```

The MCP request path no longer touches Cloudflare. `mcp.<domain>` is a DNS-only record (gray cloud) pointing at `ghs.googlehosted.com`; Cloud Run's domain mapping serves the cert directly. Cloudflare is still the DNS provider for the apex domain and still tunnels CouchDB at `vault.<domain>` — that part of the topology hasn't changed and is structurally important (CouchDB has zero public ingress without the tunnel).

## Trust at each layer

| Layer | What it trusts | What it can do if compromised |
| --- | --- | --- |
| Cloudflare DNS | Zone API token | Could redirect `mcp.<domain>` elsewhere. Mitigated by token scope (Zone:Read, DNS:Edit on this zone only) and that an attacker would also need the OAuth signing key to mint valid tokens for an alternate origin. |
| Google's anycast frontend | TLS cert ownership | Could MitM traffic if Google itself is compromised. Out-of-scope threat. |
| Cloud Run service | The OAuth access token (JWT signed by the service's own key) AND the upstream Google OIDC ID token during /authorize | A compromised running container can read/write the entire vault — it holds the LiveSync passphrase in memory while running. The container's IAM is scoped to four secrets only; no project-wide access. |
| Secret Manager | GCP IAM | Only the obsidian-mcp service account can read these specific secrets. The state bucket has a separate IAM scope. |
| Google as IdP | Account holder's password / passkey / 2FA | A compromised Google account in the email allow-list can authenticate. Mitigated by Google's own account-protection mechanisms (2FA, suspicious-sign-in alerts). |
| CouchDB | The scoped `obsidian-mcp` user's password | The MCP user has RW on one database, no admin. A compromised MCP server can't drop the database, rotate passwords, or change cluster config. |

The MCP server is the most sensitive process here because **it holds the LiveSync E2EE passphrase in memory while running**. The encryption-at-rest for the CouchDB documents stops protecting their contents the moment a process with the passphrase reads them. That's by design — Claude needs to see plaintext notes to be useful — but it means the MCP server's auth boundary is the de facto perimeter of the vault.

## Where the LiveSync passphrase lives, and what that means

The passphrase is set once in the Obsidian LiveSync plugin during Phase 1 client setup. From that point on, it lives in two places:

1. **In each LiveSync client's local config** (Mac, iPad, iPhone). LiveSync stores it in the Obsidian vault's plugin settings, encrypted by the OS keychain on each platform.
2. **In GCP Secret Manager**, after you populate `obsidian-livesync-passphrase` per [setup.md](setup.md) §2. Mounted into the Cloud Run container as the `LIVESYNC_PASSPHRASE` env var at request time. The Cloud Run service's service account has `roles/secretmanager.secretAccessor` on this single secret; no other principal in the project does.

What this means operationally:

- **Anyone who can deploy a new Cloud Run revision can read your vault.** They don't need to read the secret directly — they can deploy a revision that exfiltrates it. Treat `roles/run.developer` on this project like vault access.
- **Anyone who can read the GCS state bucket can read the OAuth signing key** if it ever lands in state (it doesn't today — Terraform creates an empty placeholder version and the real key is uploaded via `generate-oauth-key.sh`). Treat the state bucket like a secret store anyway.
- **The passphrase is unrecoverable.** If you lose it (rotate it on one client without doing it on the others, or lose the password manager), every existing note in the vault becomes unreadable. There's no escrow.

If you want to rotate the passphrase: do it in the LiveSync plugin first on a single client, let it re-encrypt the vault, then update Secret Manager and re-deploy the Cloud Run revision. Coordinate carefully — for a window during the re-encrypt, half the vault will be readable with the old passphrase and half with the new.

## In-process layout

The Cloud Run container runs a single Node 22 process with these long-lived components, wired with Effect.ts layers ([services/obsidian-mcp/src/main.ts](../../services/obsidian-mcp/src/main.ts)). The codebase layout is per-function-folder; see the [styleguide](styleguide.md) for the rules:

```
                   ┌────────────────────────────────────────┐
                   │   node:http server                     │
                   │   ─ /health unauthenticated            │
                   │   ─ /.well-known/* unauthenticated     │
                   │   ─ /register, /authorize,             │
                   │     /oauth/google/callback, /token     │
                   │     unauthenticated (OAuth bootstraps) │
                   │   ─ /mcp gated by OAuthAuthProvider    │
                   └──────────────┬─────────────────────────┘
                                  │
       ┌──────────────────────────┼──────────────────────────┐
       │                          │                          │
       ▼                          ▼                          ▼
  OAuth handlers          OAuthAuthProvider          MCP transport
  (authorize, token,      (validates access tokens)  (StreamableHTTP)
   callback, register,            │                          │
   metadata, jwks)                │                          ▼
       │                          ▼                  per-tool handlers
       ▼                    SigningKey (RS256)       (Effect-driven)
  Google OIDC                     │                          │
  (accounts.google.com)           │                          ▼
                                  │                       Vault
                                  ▼                          │
                            Secret Manager                   ▼
                            (mounted env)             CouchClient (nano)
                                                             │
                                                             ▼
                                                      HTTPS to vault.<domain>
                                                      via Cloudflare Tunnel
                                                             ▲
                                                             │ long-poll /_changes
                                                             │
                                                       ChangesFeed
```

Notable details:

- **Stateless HTTP transport.** The MCP `StreamableHTTPServerTransport` is configured with `sessionIdGenerator: undefined`, which is its stateless mode — every request is independent. This matches Cloud Run's scaling story (consecutive requests can land on different instances).
- **Stateless OAuth.** Every token (auth code, access, refresh, Google round-trip state) is a self-contained signed JWT. There's no database, no Redis, no client-registration table. Dynamic client registration returns a deterministic hash of the client metadata as the client_id; PKCE is the security boundary, not client secrets.
- **In-memory search index.** Built lazily on the first `search_notes` call after boot. Rebuilt on a debounced timer (default 5 seconds) when the CouchDB `_changes` feed reports updates from any client. For a personal-scale vault this fits comfortably in 512 MiB.
- **CPU is request-allocated.** Cloud Run is configured with `cpu_idle = true`, which means the container doesn't burn a CPU when idle. The changes-feed fiber will pause during idle periods and reconnect with backoff when traffic returns.
- **Cold start is 2–4 seconds.** Node startup + the first JWKS fetch (Google's) on the first authenticated request + the first CouchDB connection. If this is too slow, set `min_instance_count = 1` on the Cloud Run service (about $5–10/month for an always-warm instance).

## LiveSync compatibility caveats

The MCP server speaks LiveSync's CouchDB document format directly — note documents with `type: "newnote" | "plain"`, chunk documents (`type: "leaf"`, `_id` prefixed `h:`), and the path-obfuscation hashing scheme when E2EE is on.

Encryption is delegated to `octagonal-wheels` (the same npm library the LiveSync plugin uses). Each LiveSync primitive lives in its own function-folder under [services/obsidian-mcp/src/couchdb/](../../services/obsidian-mcp/src/couchdb/) — `decryptField/`, `encryptField/`, `path2id/`, `splitIntoChunks/`, `chunkId/`, `assembleChunks/`. Format-specific constants (chunk prefix `h:`, obfuscated-id prefix `f:`, the four encryption-prefix variants) live in `src/couchdb/constants.ts`. Both the primitives and the constants are faithful to the LiveSync source as of the version pinned in [troubleshooting.md](troubleshooting.md).

If the LiveSync plugin's chunk format changes (it has evolved historically — V1 → V2 → HKDF-ephemeral), reads of existing notes may start failing with `DecryptionError` or returning blank bodies. The recovery is to bump the `octagonal-wheels` dependency and update the format-dispatch in `decryptField/`. See troubleshooting.md for the recipe.

For maximum compatibility, the server only writes notes in the most recent format the plugin supports (HKDF ephemeral salt, `%$` prefix). Reads handle V2/V3/HKDF transparently. Writes don't dedupe chunks the way the plugin does at boot — it uses content-defined chunking with locality awareness. The next plugin-side normalisation pass converges on the plugin's preferred chunk shape; until then, dedup is approximate.
