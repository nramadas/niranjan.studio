# Architecture

## Request flow

```mermaid
sequenceDiagram
    participant C as Claude (desktop / iPad / iPhone)
    participant CFE as Cloudflare Edge
    participant CFA as Cloudflare Access
    participant T as Cloudflare Tunnel<br/>(cloudflared on e2-micro)
    participant S as Cloud Run<br/>(obsidian-mcp)
    participant SM as Secret Manager
    participant DB as CouchDB<br/>(localhost:5984 on e2-micro)

    C->>CFE: HTTPS POST mcp.&lt;domain&gt;/mcp<br/>headers: CF-Access-Client-Id/-Secret,<br/>Authorization: Bearer
    CFE->>CFA: validate service token / SSO
    CFA-->>CFE: signed Cf-Access-Jwt-Assertion
    CFE->>T: tunnel-encrypted HTTP w/ headers
    T->>S: HTTPS POST &lt;cloud-run-url&gt;/mcp
    S->>S: AuthProvider.validateRequest()<br/>(JWT + bearer)
    S->>SM: read LiveSync passphrase (cached after first read)
    S->>DB: GET /obsidian/&lt;note-id&gt; via vault.&lt;domain&gt; tunnel
    DB-->>S: encrypted note doc + chunks
    S->>S: assemble + decrypt with passphrase
    S-->>T: JSON-RPC tool result
    T-->>CFE: tunnel-encrypted response
    CFE-->>C: HTTPS response
```

The path is intentionally one-directional through Cloudflare. Claude never reaches the Cloud Run service or CouchDB directly — both are gated by upstream authentication (Cloudflare Access for the MCP service, no public ingress at all for CouchDB).

## Trust at each layer

| Layer | What it trusts | What it can do if compromised |
| --- | --- | --- |
| Cloudflare Edge | TLS certificate ownership | Could MitM traffic if Cloudflare itself is compromised. Out-of-scope threat. |
| Cloudflare Access | Identity provider's SSO assertion or service-token signature | Could mint a JWT for an unauthorised email. Caught by the Access application's policy. |
| Cloudflare Tunnel | The `cert.pem` on the e2-micro and the per-tunnel credentials JSON | Tunnel credentials don't authorise issuing new tokens, only routing the existing tunnel. Compromise lets an attacker route the tunnel to a different origin. Mitigated by file permissions on the VM. |
| Cloud Run service | The Cf-Access-Jwt-Assertion JWT (verified against Cloudflare's JWKS) AND the bearer token from Secret Manager | Compromise of the running container could read or write the entire vault. The container's IAM is scoped to three secrets only; no project-wide access. |
| Secret Manager | GCP IAM | Only the obsidian-mcp service account can read these specific secrets. The state bucket has a separate IAM scope. |
| CouchDB | The scoped `obsidian-mcp` user's password | The MCP user has RW on one database, no admin. A compromised MCP server can't drop the database, rotate passwords, or change cluster config. |

The MCP server is the most sensitive process here because **it holds the LiveSync E2EE passphrase in memory while running**. The encryption-at-rest for the CouchDB documents stops protecting their contents the moment a process with the passphrase reads them. That's by design — Claude needs to see plaintext notes to be useful — but it means the MCP server's auth boundary is the de facto perimeter of the vault.

## Where the LiveSync passphrase lives, and what that means

The passphrase is set once in the Obsidian LiveSync plugin during Phase 1 client setup. From that point on, it lives in two places:

1. **In each LiveSync client's local config** (Mac, iPad, iPhone). LiveSync stores it in the Obsidian vault's plugin settings, encrypted by the OS keychain on each platform.
2. **In GCP Secret Manager**, after you populate `obsidian-livesync-passphrase` per [setup.md](setup.md) §2. Mounted into the Cloud Run container as the `LIVESYNC_PASSPHRASE` env var at request time. The Cloud Run service's service account has `roles/secretmanager.secretAccessor` on this single secret; no other principal in the project does.

What this means operationally:

- **Anyone who can deploy a new Cloud Run revision can read your vault.** They don't need to read the secret directly — they can deploy a revision that exfiltrates it. Treat `roles/run.developer` on this project like vault access.
- **Anyone who can read the GCS state bucket can read the bearer token.** The Terraform state contains the random_password values. Treat the state bucket like a secret store.
- **The passphrase is unrecoverable.** If you lose it (rotate it on one client without doing it on the others, or lose the password manager), every existing note in the vault becomes unreadable. There's no escrow.

If you want to rotate the passphrase: do it in the LiveSync plugin first on a single client, let it re-encrypt the vault, then update Secret Manager and re-deploy the Cloud Run revision. Coordinate carefully — for a window during the re-encrypt, half the vault will be readable with the old passphrase and half with the new.

## In-process layout

The Cloud Run container runs a single Node 22 process with these long-lived components, wired with Effect.ts layers ([services/obsidian-mcp/src/main.ts](../../services/obsidian-mcp/src/main.ts)):

```
                   ┌────────────────────────────────────────┐
                   │   StreamableHTTPServerTransport (MCP)  │
                   │   stateless mode, /mcp endpoint        │
                   └──────────────┬─────────────────────────┘
                                  │
                   ┌──────────────▼─────────────────────────┐
                   │   AuthProvider (CloudflareAccess)      │
                   │   verifies JWT + bearer per request    │
                   └──────────────┬─────────────────────────┘
                                  │
       ┌──────────────┬───────────┴──────────────┬──────────────┐
       │              │                          │              │
       ▼              ▼                          ▼              ▼
   list_notes    read_note               search_notes      create_note
   read_recent   delete_note             append_to_note    update_note
       │              │                          │              │
       └──────┬───────┘                          └──────┬───────┘
              ▼                                          │
       ┌─────────────┐                                   │
       │   Vault     │◄──────────────────────────────────┘
       │  (read +    │
       │   write)    │       ┌─────────────────────────┐
       └──────┬──────┘       │   SearchIndex (BM25)    │
              │              │   in-memory, debounced  │
              ▼              │   rebuild on _changes   │
       ┌──────────────┐      └────────────┬────────────┘
       │ CouchClient  │◄──────────────────┘
       │  (nano)      │
       └──────┬───────┘
              ▼
       ┌──────────────────────────────────────────────┐
       │  HTTPS to vault.<domain> via Cloudflare      │
       │  Tunnel → CouchDB on e2-micro                │
       └──────────────────────────────────────────────┘
              ▲
              │  long-poll /_changes feed (separate fiber)
              │  → SearchIndex.markDirty() → debounced rebuild
              │
       ┌──────┴───────┐
       │ ChangesFeed  │
       └──────────────┘
```

Notable details:

- **Stateless HTTP transport.** The MCP `StreamableHTTPServerTransport` is configured with `sessionIdGenerator: undefined`, which is its stateless mode — every request is independent. This matches Cloud Run's scaling story (consecutive requests can land on different instances).
- **In-memory search index.** Built lazily on the first `search_notes` call after boot. Rebuilt on a debounced timer (default 5 seconds) when the CouchDB `_changes` feed reports updates from any client. For a personal-scale vault this fits comfortably in 512 MiB.
- **CPU is request-allocated.** Cloud Run is configured with `cpu_idle = true`, which means the container doesn't burn a CPU when idle. The changes-feed fiber will pause during idle periods and reconnect with backoff when traffic returns.
- **Cold start is 2–4 seconds.** Node startup + the first JWKS fetch + the first CouchDB connection. If this is too slow, set `min_instance_count = 1` on the Cloud Run service (about $5–10/month for an always-warm instance).

## LiveSync compatibility caveats

The MCP server speaks LiveSync's CouchDB document format directly — note documents with `type: "newnote" | "plain"`, chunk documents (`type: "leaf"`, `_id` prefixed `h:`), and the path-obfuscation hashing scheme when E2EE is on.

Encryption is delegated to `octagonal-wheels` (the same npm library the LiveSync plugin uses). The chunk-splitting and path-to-id derivation are reimplemented in [services/obsidian-mcp/src/couchdb/livesync.ts](../../services/obsidian-mcp/src/couchdb/livesync.ts). Both are faithful to the LiveSync source as of the version pinned in [troubleshooting.md](troubleshooting.md).

If the LiveSync plugin's chunk format changes (it has evolved historically — V1 → V2 → HKDF-ephemeral), reads of existing notes may start failing with `DecryptionError` or returning blank bodies. The recovery is to bump the `octagonal-wheels` dependency and update the format-dispatch in `livesync.ts`. See troubleshooting.md for the recipe.

For maximum compatibility, the server only writes notes in the most recent format the plugin supports (HKDF ephemeral salt, `%$` prefix). Reads handle V2/V3/HKDF transparently. Writes don't dedupe chunks the way the plugin does at boot — it uses content-defined chunking with locality awareness. The next plugin-side normalisation pass converges on the plugin's preferred chunk shape; until then, dedup is approximate.
