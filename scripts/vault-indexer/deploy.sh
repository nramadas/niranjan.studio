#!/usr/bin/env bash
#
# Build the vault-indexer image, push it to the vault-indexer Artifact
# Registry repo, ship it onto the Phase 1 e2-micro VM, write the
# container's .env from Secret Manager, and start/restart only the
# vault-indexer service in the existing docker-compose stack.
#
# Idempotent. Re-running with no source changes still pushes (the SHA
# tag is the same) and `docker compose up -d vault-indexer` no-ops if
# nothing has changed; source changes ship a new revision.
#
# Usage:
#   scripts/vault-indexer/deploy.sh \
#     --project <gcp-project> \
#     [--region us-east1] \
#     [--repo vault-indexer]
#
# Reads `terraform output` for sensible defaults — no need to type the
# project ID twice — but explicit flags win.

set -euo pipefail

# shellcheck source=../lib/common.sh
source "$(dirname "$0")/../lib/common.sh"

PROJECT=""
REGION="us-east1"
REPO="vault-indexer"

usage() {
  cat <<EOF
Usage: $(basename "$0") [--project <id>] [--region <region>] [--repo <name>]

Builds the vault-indexer container image, pushes to Artifact Registry,
ships to the Phase 1 VM via Artifact Registry pull, and restarts the
vault-indexer compose service in place.

If --project is omitted, reads gcp_project_id from \`terraform output\`.

Options:
  --project <id>      GCP project ID.
  --region <region>   Cloud Run / Artifact Registry region (default: us-east1).
  --repo <name>       Artifact Registry repo name (default: vault-indexer).
  -h, --help          Show this help.
EOF
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --project) PROJECT="${2:-}"; shift 2 ;;
      --region)  REGION="${2:-}"; shift 2 ;;
      --repo)    REPO="${2:-}"; shift 2 ;;
      -h|--help) usage; exit 0 ;;
      *)         usage >&2; die "Unknown argument: $1" ;;
    esac
  done

  if [[ -z "$PROJECT" ]]; then
    PROJECT="$(terraform -chdir=terraform output -raw gcp_project_id 2>/dev/null || true)"
    [[ -n "$PROJECT" ]] || die "--project is required (or run inside repo with terraform outputs available)."
  fi
}

# Resolve the VM name + zone from Terraform outputs so we don't have to
# pass them on every invocation. If outputs aren't available, fall back
# to the defaults.
resolve_vm() {
  VM_NAME="$(terraform -chdir=terraform output -raw instance_name 2>/dev/null || echo obsidian-sync)"
  VM_ZONE="$(terraform -chdir=terraform output -raw gcp_zone 2>/dev/null || echo us-east1-b)"
}

main() {
  parse_args "$@"
  resolve_vm

  command -v gcloud >/dev/null || die "gcloud CLI is required."
  command -v docker >/dev/null || die "docker is required."
  command -v git    >/dev/null || die "git is required."

  local repo_root
  repo_root="$(git -C "$(dirname "$0")/../.." rev-parse --show-toplevel)"
  local service_dir="${repo_root}/services/vault-indexer"
  [[ -d "$service_dir" ]] || die "Service directory not found at ${service_dir}"

  local sha
  sha="$(git -C "$repo_root" rev-parse --short=10 HEAD)"
  local registry="${REGION}-docker.pkg.dev/${PROJECT}/${REPO}"
  local image="${registry}/indexer:${sha}"
  local image_latest="${registry}/indexer:latest"

  log_info "Project:  ${PROJECT}"
  log_info "Region:   ${REGION}"
  log_info "Repo:     ${REPO}"
  log_info "VM:       ${VM_NAME} (zone=${VM_ZONE})"
  log_info "Image:    ${image}"

  log_info "Configuring docker auth for ${REGION}-docker.pkg.dev..."
  gcloud auth configure-docker "${REGION}-docker.pkg.dev" --quiet >/dev/null

  log_info "Building image (linux/amd64; build context is repo root for shared workspace)..."
  # --platform=linux/amd64 because the VM runs amd64 and Apple Silicon devs default to arm64.
  docker build \
    --platform=linux/amd64 \
    -t "$image" -t "$image_latest" \
    -f "${service_dir}/Dockerfile" \
    "$repo_root"

  log_info "Pushing image..."
  docker push "$image"
  docker push "$image_latest"

  log_info "Configuring docker auth on the VM and pulling the image..."
  gcloud compute ssh "$VM_NAME" \
    --project="$PROJECT" \
    --zone="$VM_ZONE" \
    --command="sudo -u root gcloud auth configure-docker ${REGION}-docker.pkg.dev --quiet >/dev/null && sudo docker pull ${image}"

  # Fetch secrets on the LOCAL machine, not the VM. The e2-micro's slow
  # persistent disk makes `gcloud` cold-start take ~8s per invocation;
  # running 4 fetches on the VM adds minutes to every deploy. Locally,
  # gcloud is warm and the same fetches finish in ~1s total. The values
  # are inlined into the SSH heredoc below, so secrets exist only briefly
  # as local shell vars + over the SSH stdin channel.
  log_info "Fetching secrets from Secret Manager (local)..."
  local search_token openai_key couchdb_password livesync_passphrase couchdb_user couchdb_db
  search_token="$(gcloud secrets versions access latest --project="$PROJECT" --secret=vault-indexer-search-token)"
  openai_key="$(gcloud secrets versions access latest --project="$PROJECT" --secret=vault-indexer-openai-key 2>/dev/null || true)"
  couchdb_password="$(gcloud secrets versions access latest --project="$PROJECT" --secret=obsidian-mcp-couchdb-password)"
  livesync_passphrase="$(gcloud secrets versions access latest --project="$PROJECT" --secret=obsidian-livesync-passphrase)"
  couchdb_user="$(terraform -chdir=terraform output -raw obsidian_mcp_couchdb_user 2>/dev/null || echo obsidian-mcp)"
  couchdb_db="$(terraform -chdir=terraform output -raw couchdb_admin_user 2>/dev/null || echo obsidian)"

  log_info "Writing /opt/vault-indexer/.env and /opt/obsidian/docker-compose.indexer.yml on the VM..."
  # The env file lives outside the compose file so a token rotation is
  # one `gcloud secrets versions add` + a `deploy.sh` rerun. We do NOT
  # bake the token into the image.
  #
  # The compose override file is written by this script (not by
  # cloud-init) so a redeploy can recover from a VM whose
  # /opt/obsidian/docker-compose.yml predates the indexer — deploy.sh
  # owns the indexer's service definition end-to-end.
  # shellcheck disable=SC2087  # we want secrets resolved on the local side, then inlined into the SSH stdin
  gcloud compute ssh "$VM_NAME" \
    --project="$PROJECT" \
    --zone="$VM_ZONE" \
    --command="bash -s" <<REMOTE
set -euo pipefail
sudo mkdir -p /opt/vault-indexer/data
# Container runs as uid 1000 (the \`node\` user in node:22-bookworm-slim).
# /opt/vault-indexer/data is bind-mounted to /var/lib/vault-indexer inside
# the container, where SQLite writes vectors.db — the host dir must be
# writable by uid 1000 or the open() call fails with "unable to open".
sudo chown -R 1000:1000 /opt/vault-indexer/data

sudo tee /opt/vault-indexer/.env >/dev/null <<EOF
COUCHDB_URL=http://couchdb:5984
COUCHDB_DB=${couchdb_db}
COUCHDB_USER=${couchdb_user}
COUCHDB_PASSWORD=${couchdb_password}
LIVESYNC_PASSPHRASE=${livesync_passphrase}
EMBEDDER=bge-small
MODEL_DIR=/opt/vault-indexer/model
SQLITE_PATH=/var/lib/vault-indexer/vectors.db
SEARCH_BEARER_TOKEN=${search_token}
OPENAI_API_KEY=${openai_key}
PORT=8081
BIND_ADDR=0.0.0.0
LOG_LEVEL=info
EOF
sudo chmod 600 /opt/vault-indexer/.env

sudo tee /opt/obsidian/docker-compose.indexer.yml >/dev/null <<'YML'
services:
  vault-indexer:
    image: ${image}
    container_name: vault-indexer
    restart: unless-stopped
    depends_on:
      - couchdb
    env_file:
      - /opt/vault-indexer/.env
    ports:
      # Bind to localhost only. The Cloudflare tunnel on the same host
      # dials 127.0.0.1:8081 for the indexer.<domain> ingress.
      - "127.0.0.1:8081:8081"
    volumes:
      - /opt/vault-indexer/data:/var/lib/vault-indexer
YML
REMOTE

  log_info "Bringing up vault-indexer..."
  gcloud compute ssh "$VM_NAME" \
    --project="$PROJECT" \
    --zone="$VM_ZONE" \
    --command="cd /opt/obsidian && sudo docker compose -f docker-compose.yml -f docker-compose.indexer.yml up -d vault-indexer"

  log_info "Waiting for /health to return 200..."
  local ok=0
  for _ in $(seq 1 30); do
    if gcloud compute ssh "$VM_NAME" \
        --project="$PROJECT" \
        --zone="$VM_ZONE" \
        --command="curl -fsS http://127.0.0.1:8081/health -o /dev/null" \
        >/dev/null 2>&1; then
      ok=1
      break
    fi
    sleep 2
  done
  [[ $ok -eq 1 ]] || die "vault-indexer /health did not return 200 within 60s. Check logs: gcloud compute ssh ${VM_NAME} --project=${PROJECT} --zone=${VM_ZONE} --command 'cd /opt/obsidian && sudo docker compose -f docker-compose.yml -f docker-compose.indexer.yml logs --tail 200 vault-indexer'"

  cat <<EOF

────────────────────────────────────────────────────────────────────────
Deployed ${image} as vault-indexer on ${VM_NAME}.

Tail logs:
  gcloud compute ssh ${VM_NAME} --project=${PROJECT} --zone=${VM_ZONE} \\
    --command 'cd /opt/obsidian && sudo docker compose -f docker-compose.yml -f docker-compose.indexer.yml logs --tail 200 -f vault-indexer'

Run the initial backfill (one-time, idempotent):
  scripts/vault-indexer/run-backfill.sh --project ${PROJECT}
────────────────────────────────────────────────────────────────────────
EOF
}

main "$@"
