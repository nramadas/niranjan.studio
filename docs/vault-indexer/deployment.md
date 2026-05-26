# Deployment

Reference for the Phase 3 deploy flow: how images move from your laptop to the e2-micro, how the compose stack is updated in place, where logs live, and how to roll back.

## Image transport

The indexer image is built locally (Docker), pushed to **Artifact Registry** (`vault-indexer` repo, separate from the Phase 2 `obsidian-mcp` repo), and pulled on the VM. Chosen because Artifact Registry is already in use from Phase 2, so reusing the same service with a separate repo is a one-line IAM grant (`artifactregistry.reader` on the new repo, scoped to the VM service account) and zero new infrastructure.

Alternatives considered and rejected:

- **SCP a tarball**: works on a fast LAN but cross-continent `gcloud compute scp` of a ~200 MB image is slow and the tarball lingers on disk.
- **Build on the VM**: bad on 1 GB RAM. A multi-stage Node + ONNX build is 1+ GB of memory pressure; it would OOM the VM during the build.

The Docker build context is the **repository root**, not `services/vault-indexer/`. That's because the workspace shared package (`services/shared/`) is reachable only from above the service dir. `scripts/vault-indexer/deploy.sh` handles this with `docker build -f services/vault-indexer/Dockerfile <repo-root>`.

## The compose stack on the VM

Phase 1 set up a docker-compose stack at `/opt/obsidian/docker-compose.yml` (the file is written by cloud-init at first boot). Phase 3 extends that file with a second service, `vault-indexer`, defined under the `indexer` compose profile so it stays opt-in:

```yaml
vault-indexer:
  image: ${VAULT_INDEXER_IMAGE:-busybox:1.36}
  container_name: vault-indexer
  restart: unless-stopped
  depends_on:
    - couchdb
  env_file:
    - /opt/vault-indexer/.env
  environment:
    COUCHDB_URL: http://couchdb:5984
  ports:
    - "127.0.0.1:8081:8081"
  volumes:
    - /opt/vault-indexer/data:/var/lib/vault-indexer
  profiles:
    - indexer
```

The `${VAULT_INDEXER_IMAGE:-busybox:1.36}` line is a compose-time default that lets a fresh VM bootstrap come up cleanly even before any indexer image has been pushed — without the default, `docker compose up` would fail at parse time. `deploy.sh` writes `VAULT_INDEXER_IMAGE=...` into `/opt/obsidian/.env` (the compose env file) before bringing the service up under `--profile indexer`.

`COUCHDB_URL=http://couchdb:5984` short-circuits the Cloudflare tunnel for the in-VM indexer→CouchDB hop — the two containers share the compose network and reach each other by service name. The `.env` file's `COUCHDB_URL` would normally point at `https://vault.<domain>` for an off-VM consumer; here it's overridden to keep the path local.

## What `deploy.sh` does, step by step

1. Resolve `--project` (from flag or `terraform output`).
2. Build the image (linux/amd64, repo-root context).
3. Push `indexer:<git-sha>` and `indexer:latest` to AR.
4. SSH to the VM, `gcloud auth configure-docker` on it, `docker pull <image>`.
5. SSH to the VM, write `/opt/vault-indexer/.env` from Secret Manager (CouchDB creds, LiveSync passphrase, search bearer token, OpenAI key if populated).
6. SSH to the VM, write `VAULT_INDEXER_IMAGE=...` into `/opt/obsidian/.env`.
7. SSH to the VM, `docker compose --profile indexer up -d vault-indexer`.
8. Poll `http://127.0.0.1:8081/health` from inside the VM for up to 60 s.
9. Print a deploy banner with the logs command.

Failure at any step halts the script with a non-zero exit code; the banner is only printed on green.

## Backups

The SQLite file at `/opt/vault-indexer/data/vectors.db` is **regenerable from CouchDB** via the backfill, so losing it is a recoverable mistake rather than a disaster. That said, a backup makes recovery fast.

**Phase 1's backup mechanism (whatever you use)** should include `/opt/vault-indexer/data/` alongside `/opt/obsidian/data/` (CouchDB) and `/opt/obsidian/etc/` (CouchDB config). If Phase 1 doesn't already snapshot or tarball these paths, extend it now. A typical backup script looks like:

```
sudo systemctl stop docker
sudo tar -czf /tmp/obsidian-backup-$(date +%Y%m%d).tgz \
  /opt/obsidian/data \
  /opt/obsidian/etc \
  /opt/vault-indexer/data
gsutil cp /tmp/obsidian-backup-*.tgz gs://<your-backup-bucket>/
sudo systemctl start docker
```

Stopping docker is important: SQLite + sqlite-vec are durable but a live `.db` file can be in-the-middle-of-a-WAL-checkpoint at any moment. The CouchDB data dir is similarly happier with the daemon down. If you want a hot-backup story for the indexer specifically, run `VACUUM INTO` inside the container before the tarball.

## Logs

Indexer logs go to stdout in JSON-line format (the same `cloudRunLogger` Phase 2 uses on Cloud Run). On the VM they're captured by Docker:

```
# tail live
gcloud compute ssh <vm> --command \
  'cd /opt/obsidian && sudo docker compose logs --tail 200 -f vault-indexer'

# last hour
gcloud compute ssh <vm> --command \
  'cd /opt/obsidian && sudo docker compose logs --since 1h vault-indexer'
```

The MCP server's `WARN indexer unavailable (...)` lines live in Cloud Run logs:

```
gcloud run services logs tail obsidian-mcp --project=<id> --region=<region>
```

Filter for hybrid-search degradation events with `--log-filter 'indexer unavailable'`.

## Rollback

If a new indexer revision is misbehaving, roll back to the previous image tag. Artifact Registry retains tags indefinitely.

```
# list recent tags
gcloud artifacts docker tags list \
  us-east1-docker.pkg.dev/<proj>/vault-indexer/indexer \
  --limit 10

# pin compose to the previous SHA
gcloud compute ssh <vm> --command 'sudo sed -i "s|^VAULT_INDEXER_IMAGE=.*$|VAULT_INDEXER_IMAGE=us-east1-docker.pkg.dev/<proj>/vault-indexer/indexer:<prev-sha>|" /opt/obsidian/.env'

# bring it up
gcloud compute ssh <vm> --command \
  'cd /opt/obsidian && sudo docker compose pull vault-indexer && sudo docker compose up -d vault-indexer'
```

`vectors.db` is forward-compatible across most patch versions — a rollback doesn't usually require a re-backfill. Exception: if the rollback crosses a schema change (`schema.sql` differs), delete `vectors.db` and re-run backfill afterwards.

## What's NOT here

- **No CI/CD.** Deploys are local-laptop affairs today. If you wire up GitHub Actions later, mirror what `deploy.sh` does: `pnpm install`, `pnpm -r build`, `docker build` with the repo root as context, AR push, then `gcloud compute ssh ... docker compose up -d`.
- **No blue/green.** A single VM running a single container has no failover. The `restart: unless-stopped` policy plus the 60 s `/health` poll in `deploy.sh` are the closest thing to a safety net.
- **No autoscaling.** The whole point of the indexer being on the VM is that it has a single writer to the SQLite file. Scaling it horizontally requires a different storage layer.
