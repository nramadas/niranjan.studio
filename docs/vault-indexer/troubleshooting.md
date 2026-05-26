# Troubleshooting

Common Phase 3 failure modes mapped to symptom → diagnosis → fix.

## `terraform apply` fails with Cloudflare `Authentication error (10000)`

**Symptom:** `terraform apply` fails partway with errors on `cloudflare_access_application` and `cloudflare_access_service_token`, both saying `error from makeRequest: Authentication error (10000)`. Often paired with a cascading Cloud Run error: `Secret projects/.../secrets/vault-indexer-cf-access-client-id/versions/latest was not found`.

**Diagnosis:** the Cloudflare API token authenticated but lacks Account-level Access permissions. Cloudflare error 10000 is "Authentication error" but it covers permission denial as well as token-invalid. The DNS-only token created during Phase 1 (`Zone:Read` + `DNS:Edit`) is not sufficient for Access resources — those live under Zero Trust, which is an Account-level surface.

The Cloud Run error is a downstream consequence: when the service token doesn't get created, the secret_version resources that derive their value from `cloudflare_access_service_token.mcp_to_indexer.client_id` / `.client_secret` can't be populated, leaving the CF Access secrets in Secret Manager with no `latest` version for Cloud Run to read.

**Fix:**

1. In Cloudflare dashboard → **My Profile → API Tokens**, edit the token used by `cloudflare_api_token` in `terraform.tfvars` (or create a new one) and add:
   - **Account → Access: Apps and Policies → Edit**
   - **Account → Access: Service Tokens → Edit**

   Keep the existing `Zone:Read` + `DNS:Edit` permissions. The Account Resources scope should include the account that owns your zone.

2. If you created a new token, paste the new value into `terraform/terraform.tfvars`.

3. Confirm Zero Trust is enabled for your account: Cloudflare dashboard → **Zero Trust** sidebar. Free for up to 50 users; if you've never set it up, accept the one-time team-name picker.

4. Re-run `terraform apply`. The Access resources will now create; the secret_versions populate from them; Cloud Run rolls a healthy revision.

## `terraform apply` fails with "Secret versions/latest was not found" on Cloud Run

**Symptom:** `terraform apply` succeeds on the Cloudflare resources but fails on `google_cloud_run_v2_service.obsidian_mcp` with:

```
Revision 'obsidian-mcp-NNNNN-XXX' is not ready and cannot serve traffic.
spec.template.spec.containers[0].env[N].value_from.secret_key_ref.name:
  Secret projects/PROJECT_NUMBER/secrets/vault-indexer-cf-access-client-id/versions/latest was not found
```

**Diagnosis:** dependency race. Cloud Run validates that every env-var-from-secret reference resolves to an existing secret version at update time. The Cloudflare-API-backed secret versions (`vault-indexer-cf-access-client-id` / `-client-secret`) take seconds to create — long enough that Cloud Run can be attempted in parallel and lose the race. The Terraform configuration now declares an explicit `depends_on` from Cloud Run to those secret_versions to prevent this; if you applied an older configuration, you can still hit the race once.

**Fix:**

1. Confirm the secret versions DID actually get created in the failed apply:
   ```bash
   gcloud secrets versions list vault-indexer-cf-access-client-id  --project=<id> --format='value(name)' | wc -l
   gcloud secrets versions list vault-indexer-cf-access-client-secret --project=<id> --format='value(name)' | wc -l
   ```
   Both should return at least 1.

2. Re-run `terraform apply`. With versions in place from the prior partial apply, the Cloud Run update now finds them and succeeds.

If either count is 0, the underlying Cloudflare resource failed too — see the previous section.

## Indexer not receiving `_changes` events

**Symptom:** edit a note in Obsidian, wait 30 s, the indexer logs show nothing. `docker compose logs vault-indexer` is quiet.

**Diagnosis:** the subscription either never started or has died and the reconnect backoff hasn't fired yet.

**Fix:**

```
gcloud compute ssh <vm> --command \
  'cd /opt/obsidian && sudo docker compose logs --tail 200 vault-indexer | grep -i changes'
```

If you see `changes feed retries exhausted, daemon exiting` — restart the container:

```
sudo docker compose restart vault-indexer
```

If the restart immediately produces the same line, the CouchDB credentials in `/opt/vault-indexer/.env` are wrong. Re-run `scripts/vault-indexer/deploy.sh` to refresh them from Secret Manager.

## Backfill fails partway through

**Symptom:** `run-backfill.sh` errors out with `EmbeddingError` or `CouchDbError` or `DecryptionError` after some progress.

**Diagnosis:** the backfill catches per-note failures and continues; a full halt usually means a layer-level error (the embedder itself, the SQLite handle, the CouchDB connection). Look at the last log line.

**Fix:**

- `DecryptionError` on every note → LiveSync passphrase is wrong. `gcloud secrets versions access latest --secret=obsidian-livesync-passphrase` should match what's in your Obsidian client.
- `CouchDbError op=getDoc status=401` → MCP user creds are wrong. Re-run `scripts/obsidian-mcp/create-couchdb-user.sh`.
- `EmbeddingError model=bge-small` → model files missing from the image. Rebuild with `scripts/vault-indexer/deploy.sh`; the model-fetch Docker stage downloads them. If that stage failed at build time, check your local Docker can reach `huggingface.co`.
- `OOM` or container killed (`docker compose ps` shows the container exited 137) → the e2-micro is at memory pressure. See § Memory pressure below.

Re-running the backfill after fixing is safe — content-addressed diffing means nothing already-embedded gets re-embedded.

## sqlite-vec extension fails to load

**Symptom:** indexer logs `failed to load sqlite-vec extension: <error>` at boot and exits.

**Diagnosis:** the `sqlite-vec` npm package is missing the platform-specific subpackage for linux-x64, or `better-sqlite3` was built against a different libc.

**Fix:**

The Docker build should produce a runtime image with `sqlite-vec-linux-x64` (and only that one) installed by pnpm — npm's `optionalDependencies` mechanism picks the right platform automatically when the install runs on linux-x64.

```
gcloud compute ssh <vm> --command \
  'sudo docker exec vault-indexer ls -la /app/node_modules/sqlite-vec-linux-x64/' \
  2>/dev/null
```

If the directory is missing, you almost certainly built the image on macOS without `--platform=linux/amd64`. Rebuild with `scripts/vault-indexer/deploy.sh` (which sets the platform correctly) and redeploy.

## SQLite "database is locked"

**Symptom:** `/search` returns 500 with `VectorStoreError op=knn code=SQLITE_BUSY` and the indexer log shows the same.

**Diagnosis:** `better-sqlite3` is synchronous and uses one connection; with one writer (the reindex pipeline) and concurrent readers (`/search`), the database should never be locked in practice. If it is, the indexer's container is sharing the SQLite file with another process — usually a forgotten `docker compose run` that someone left attached.

**Fix:**

```
gcloud compute ssh <vm> --command 'sudo docker ps -a | grep vault-indexer'
```

If there's a stopped `vault-indexer-run-XXX` container holding a handle, remove it:

```
sudo docker rm -f vault-indexer-run-XXX
```

Then restart the main container to reset its connection.

## MCP server can't reach `/search`

**Symptom:** Cloud Run logs show `WARN indexer unavailable (timeout); falling back to lexical-only` or `(network)` or `(bad_status status=403)`. `search_notes` still returns results, just lexical-only — the degradation is the intended behaviour. The question is whether it's *correctly* unable to reach the indexer (the indexer is genuinely down) or whether something's wrong in the path.

**Diagnosis:**

| Reason | Likely cause |
|---|---|
| `timeout` | Indexer is up but slow. Check `docker compose logs vault-indexer` for `bge-small inference failed` or sustained high latency. |
| `network` | DNS or tunnel issue. `dig indexer.<domain>` should resolve to a Cloudflare address. |
| `bad_status status=403` | Cloudflare Access denied the request. The MCP service token is wrong, or the policy doesn't include it. |
| `bad_status status=401` | Cloudflare let the request through but the indexer rejected the bearer token. The `INDEXER_BEARER_TOKEN` env on Cloud Run doesn't match `SEARCH_BEARER_TOKEN` on the VM. |

**Fix:**

- 403: confirm `terraform plan` is clean for `cloudflare_access_policy.indexer_allow_service_token` and that the `include.service_token` includes the right token id. Re-apply if needed.
- 401: the service token Secret Manager values for `vault-indexer-search-token` (used by indexer) and the same secret reference in `obsidian-mcp.tf` (used by MCP) point to the same secret, so a mismatch shouldn't be possible in production. If you've manually edited either side, re-deploy both.
- The MCP server falling back to lexical-only is **the safety net working**, not a failure to repair. Investigate, but `search_notes` itself remains useful in the meantime.

## Search results are stale after an edit

**Symptom:** edit a note in Obsidian, wait, ask Claude to search for content from the edit, it doesn't appear.

**Diagnosis:** the change event hasn't been processed yet. Walk the path:

1. Did LiveSync sync? `gcloud compute ssh <vm> --command 'sudo docker compose exec couchdb curl -s http://localhost:5984/obsidian/_changes?since=now-100&limit=10'` — should show recent doc ids.
2. Did the indexer receive the event? `docker compose logs vault-indexer | tail -50` — should show a `reindexed ...` line within `CHANGES_DEBOUNCE_MS + a few seconds`.
3. Did the backfill cover this note? If the note is older than the last backfill and was never edited since, only the backfill would have indexed it.

**Fix:** wait `CHANGES_DEBOUNCE_MS` (2 s default) and retry. If still not present, restart the indexer to force a fresh subscription. If the note is from before the last backfill and was never re-saved, run the backfill.

## Embedding model weights missing from the image

**Symptom:** indexer logs `failed to load bge-small pipeline from /opt/vault-indexer/model: Could not locate file: ...` and exits.

**Diagnosis:** the Dockerfile's model-fetch stage didn't run, or its output didn't make it into the runtime stage.

**Fix:** look at the build log. The model-fetch stage prints `downloading bge-small-en-v1.5 quantized ONNX...` followed by `done`. If you see download failures (DNS, 403 from Hugging Face), check your local network — the model-fetch stage requires outbound to `huggingface.co`. Once it's downloaded, the runtime stage `COPY`s `/opt/vault-indexer/model` from model-fetch. Verify with:

```
docker run --rm us-east1-docker.pkg.dev/<proj>/vault-indexer/indexer:latest ls /opt/vault-indexer/model
```

Should show a directory tree under `Xenova/bge-small-en-v1.5/`.

## Dimensionality mismatch between schema and model

**Symptom:** `VectorStoreSchemaError expected={ ..., dim: 384 } found={ ..., dim: 768 }` at boot.

**Diagnosis:** you started the container with a model whose dimensionality doesn't match what's recorded in `index_meta`. This is exactly the safety check working.

**Fix:** decide which way you want to go.

- **Use the model the file was built with.** Set `EMBEDDER` to that model and redeploy.
- **Re-embed under the new model.** Stop the indexer, delete `vectors.db`, restart, run backfill. See [embedding-model.md](embedding-model.md) §3 for the full recipe.

## Tunnel / Access policy misconfiguration

**Symptom:** the workstation curl against `https://indexer.<domain>/health` returns the wrong status or no body.

**Diagnosis:** by status:

- **403 (no token)** — expected. Cloudflare Access is doing its job.
- **403 (with token)** — the Access policy doesn't include this service token's id. Check the Terraform `cloudflare_access_policy.indexer_allow_service_token` resource.
- **502 / 524** — cloudflared is up, but the local upstream isn't reachable on `127.0.0.1:8081`. The indexer container isn't running; `docker compose ps` should show it.
- **No DNS resolution** — `cloudflare_record.indexer` wasn't applied (likely because `cloudflare_tunnel_id` is still empty in tfvars). Set it and re-apply.

**Fix:** check each layer in order — DNS, cloudflared rule, Access policy, indexer health — and the symptom usually narrows to one bad link.

## Memory pressure

**Symptom:** indexer container exits with code 137 (SIGKILL by OOMKiller), or the VM is sluggish, or `top` shows swap in use.

**Diagnosis:** the e2-micro has 1 GB RAM. CouchDB resident is ~150 MB, cloudflared ~30 MB, the indexer at idle is ~100 MB, the indexer during inference is 200–300 MB. Headroom is tight. Sustained pressure usually means the indexer is doing a backfill while CouchDB is replicating from a fresh Obsidian client.

**Fix:**

```
gcloud compute ssh <vm> --command 'free -m && top -bn1 -o %MEM | head -20'
```

Short-term: stop the backfill (`docker compose stop vault-indexer`), let the other workload finish, restart, resume backfill.

Long-term: upgrade to **e2-small** (2 GB, ~$7/mo, no longer free-tier). Change `machine_type = "e2-micro"` to `"e2-small"` in `terraform/obsidian.tf` and `terraform apply`. The VM will reboot. Document the cost in the runbook.

If you stay on e2-micro and the memory is recurringly tight, consider a smaller embedding model (there are 256-dim variants of bge family). Not yet implemented; see [embedding-model.md](embedding-model.md) §5.
