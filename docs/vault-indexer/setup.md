# Phase 3 setup — semantic search

End-to-end walkthrough for standing up the vault-indexer next to your existing Phase 1 CouchDB and your Phase 2 Cloud Run MCP service. After this you can ask Claude to find notes by meaning, not just keyword overlap, and the MCP server's `search_notes` tool returns hybrid (BM25 + semantic) results by default.

This document assumes Phases 1 and 2 are already deployed and working. If they aren't, read [docs/obsidian/setup.md](../obsidian/setup.md) and [docs/obsidian-mcp/setup.md](../obsidian-mcp/setup.md) first.

## What you're setting up

```
┌──────────────────────────────┐         ┌──────────────────────────────┐
│   Cloud Run obsidian-mcp     │         │     e2-micro VM (Phase 1)    │
│   (search_notes: hybrid)     │         │                              │
│                              │   HTTP  │  CouchDB  ◄── Phase 1 sync   │
│   BM25 in-process  ─┐        │   ----► │     │                        │
│                     ├─ RRF ──┼─────────┤  vault-indexer (new):        │
│   indexer client ◄──┘        │  Access │     ├─ _changes subscriber   │
│                              │   gate  │     ├─ bge-small embedder    │
└──────────────────────────────┘         │     ├─ sqlite-vec file       │
                                         │     └─ /search endpoint      │
                                         └──────────────────────────────┘
```

The indexer runs on the **existing** Phase 1 VM. No new compute. Terraform manages secrets, IAM, an Artifact Registry repo, a Cloudflare Access app + service token + policy, and a DNS record. The cloudflared ingress rule on the VM is added by `scripts/vault-indexer/add-tunnel-route.sh` (same pattern as Phase 1).

## Sequence

### 1. Apply Terraform

**Pre-flight: expand the Cloudflare API token's permissions.** Phase 1's token was scoped to `Zone:Read` + `DNS:Edit` only — enough for DNS records, but Cloudflare Access (Zero Trust) needs additional Account-level permissions. Without these, `terraform apply` fails on `cloudflare_access_application` and `cloudflare_access_service_token` with `Authentication error (10000)`, and Cloud Run cascades a "Secret … versions/latest was not found" error on the CF Access secret refs.

In the Cloudflare dashboard → **My Profile → API Tokens**, edit the token referenced by `cloudflare_api_token` in `terraform.tfvars` (or create a new one) and add:

- **Account → Access: Apps and Policies → Edit**
- **Account → Access: Service Tokens → Edit**

Keep the existing `Zone:Read` + `DNS:Edit` permissions. The Account Resources should include the account that owns your zone.

Verify Zero Trust is enabled for your account — Cloudflare dashboard → **Zero Trust** sidebar entry. It's free for up to 50 users; if you've never set it up, you'll be walked through a one-time team-name picker.

Then apply:

```
terraform -chdir=terraform plan
terraform -chdir=terraform apply
```

What this does:
- Creates `vault-indexer-search-token` (Terraform-generated random password).
- Creates `vault-indexer-openai-key` with a placeholder + `lifecycle.ignore_changes`. You only populate this if you intend to run the OpenAI evaluation harness; the production indexer doesn't need it.
- Creates the `vault-indexer` Artifact Registry repo and grants the VM SA reader access.
- Creates the Cloudflare Access application for `indexer.<domain>`, a service token named `obsidian-mcp-to-vault-indexer`, and a policy that admits only that token.
- Writes the service-token's `client_id` / `client_secret` to `vault-indexer-cf-access-client-id` / `vault-indexer-cf-access-client-secret`, granting the MCP SA reader access.
- Adds five new env-var declarations to the Cloud Run MCP service (`INDEXER_URL`, `INDEXER_TIMEOUT_MS`, plus three secret refs). The image itself doesn't change — `lifecycle.ignore_changes` on `image` is preserved.

**What success looks like:** `terraform apply` completes; `terraform output vault_indexer_url` returns `https://indexer.<domain>`.

**What usually goes wrong:**

- `Authentication error (10000)` on `cloudflare_access_application` or `cloudflare_access_service_token` — the API token lacks Account-level Access permissions. See the pre-flight above. Cascades into a Cloud Run "Secret versions/latest was not found" error on the CF Access secret refs in the same apply.
- "Secret … versions/latest was not found" on Cloud Run **without** a preceding Cloud flare auth error — the Cloudflare resources created successfully but Cloud Run raced the secret_version write. The Terraform graph has explicit `depends_on` to prevent this, but if you applied an older revision of the configuration, `terraform apply` a second time clears it (the secret_version is now in place from the prior partial apply). Confirm with `gcloud secrets versions list vault-indexer-cf-access-client-id` returning a row before re-applying.
- The Cloudflare provider can also fail on Access resources if your zone has Zero Trust disabled. Enable Access in the dashboard's Zero Trust section (it's free for up to 50 users) and re-apply.

### 2. Deploy the indexer to the VM

```
scripts/vault-indexer/deploy.sh --project <your-project>
```

What this does:
- Builds the indexer image (linux/amd64) with the repo root as the Docker context (workspace shared package), pushing to the `vault-indexer` AR repo as `indexer:<git-sha>` and `indexer:latest`.
- Configures docker auth on the VM, pulls the image.
- Writes `/opt/vault-indexer/.env` on the VM from Secret Manager: CouchDB creds, LiveSync passphrase, the search bearer token, and (if populated) the OpenAI key.
- Pins `VAULT_INDEXER_IMAGE=...` in `/opt/obsidian/.env`.
- Runs `docker compose --profile indexer up -d vault-indexer`.
- Polls `http://127.0.0.1:8081/health` from inside the VM until it returns 200.

**What success looks like:** the script ends with a "Deployed ..." banner and a logs command. `docker compose logs vault-indexer` on the VM shows a "listening on 0.0.0.0:8081" line and a "vector store initialised" line.

**What usually goes wrong:**
- Docker auth not configured for AR. The script does it; if you've never run gcloud as the VM user it may prompt. Use `sudo gcloud auth configure-docker us-east1-docker.pkg.dev --quiet` directly on the VM to debug.
- Out-of-memory at first-call inference. The e2-micro is 1 GB. Watch `top` inside the VM during the first `/search` call. See [troubleshooting.md](troubleshooting.md) § Memory pressure.

### 3. Run the initial backfill

```
scripts/vault-indexer/run-backfill.sh --project <your-project>
```

What this does: runs `docker compose run --rm vault-indexer node dist/backfill.js`, which lists every note via `Vault.readAllForIndex`, chunks each one, embeds new chunks, populates `vectors.db`. Progress lines like `[N/M] notes/path.md: +X -Y =Z` stream to your terminal.

Expected runtime: roughly 3–5 minutes for a vault of ~1000 notes on the e2-micro CPU. Measure on yours.

**What success looks like:** the script ends with `backfill complete`. The SQLite file at `/opt/vault-indexer/data/vectors.db` is non-empty.

**What usually goes wrong:**
- LiveSync passphrase wrong → every note fails to decrypt. Check `obsidian-livesync-passphrase` in Secret Manager and re-deploy the indexer (the deploy script reads it fresh).
- CouchDB user lacks read access → 401s in the log. Re-run `scripts/obsidian-mcp/create-couchdb-user.sh` if you haven't.

### 4. Add the tunnel route

```
scripts/vault-indexer/add-tunnel-route.sh --project <your-project>
```

What this does: SSHes to the VM, opens `~/.cloudflared/config.yml`, inserts an `- hostname: indexer.<domain>\n  service: http://127.0.0.1:8081` ingress rule **above the catch-all 404**, and reloads cloudflared.

Idempotent: re-running with the rule already present is a no-op.

**What success looks like:** from your workstation:

```
curl -i https://indexer.<domain>/health
```

returns **403** from Cloudflare Access (the call has no service token). With the service token:

```
CF_ID=$(gcloud secrets versions access latest --project=<proj> --secret=vault-indexer-cf-access-client-id)
CF_SECRET=$(gcloud secrets versions access latest --project=<proj> --secret=vault-indexer-cf-access-client-secret)
curl -i \
  -H "CF-Access-Client-Id: $CF_ID" \
  -H "CF-Access-Client-Secret: $CF_SECRET" \
  https://indexer.<domain>/health
```

returns **200** with `{ "ok": true, "count": N }`.

**What usually goes wrong:**
- `cloudflared` not running as a systemd unit. Phase 1's `setup-tunnel.sh` should have done this; if not, `sudo systemctl enable --now cloudflared`.
- A typo'd hostname in the access rule. The script's awk-insertion is exact-match — re-run with the correct domain.

### 5. Redeploy the MCP server with the new env vars

```
scripts/obsidian-mcp/deploy.sh --project <your-project>
```

The image itself doesn't *have* to change to pick up the new env vars (Cloud Run sources them from Secret Manager at request time), but redeploying ensures everything is in sync and gives you a known-good revision tagged with the current git SHA.

**What success looks like:** Cloud Run logs show `booting obsidian-mcp on :8080 (auth=oauth)` and no warnings about missing INDEXER_URL.

### 6. Verify end-to-end through Claude

Open a Claude conversation with the obsidian-mcp connector attached, then ask:

> Search my notes for "ideas about how to handle long-running effects in TypeScript". Use hybrid mode.

Then:

> Same query but with mode=lexical.

> Same query but with mode=semantic.

You should see the three modes return different rankings. The hybrid mode's top hits should be a sensible blend.

Finally, simulate the indexer being down:

```
gcloud compute ssh <vm> --command 'sudo docker compose stop vault-indexer'
```

Ask Claude to search again. The MCP server should log a `WARN indexer unavailable (network); falling back to lexical-only` line and return BM25-only results. **`search_notes` must not fail.** Bring it back up with `docker compose start vault-indexer`.
