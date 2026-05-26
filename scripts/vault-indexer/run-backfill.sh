#!/usr/bin/env bash
#
# Trigger a one-shot backfill of the vault-indexer's vector store
# against the current state of CouchDB. Idempotent: chunks whose hashes
# already exist are skipped; only genuinely new chunks get embedded.
#
# Run AFTER deploy.sh has shipped the indexer image to the VM and after
# the LiveSync passphrase / Couch credentials have been populated. The
# backfill reads /opt/vault-indexer/.env on the VM for its config.
#
# Usage:
#   scripts/vault-indexer/run-backfill.sh --project <gcp-project>

set -euo pipefail

# shellcheck source=../lib/common.sh
source "$(dirname "$0")/../lib/common.sh"

PROJECT=""

usage() {
  cat <<EOF
Usage: $(basename "$0") [--project <id>]

Triggers the vault-indexer's one-shot backfill on the e2-micro VM.

Idempotent: chunks already present are skipped; only new chunks get
embedded.

Options:
  --project <id>   GCP project ID (defaults to terraform output).
  -h, --help       Show this help.

Expected runtime: roughly 3-5 minutes for a vault of ~1000 notes on
the e2-micro CPU. Measure on your machine.
EOF
}

# Restart the live indexer. Called from the EXIT trap so the live
# indexer comes back up regardless of whether the backfill succeeded or
# failed. Reads script-scope vm / zone / compose_cmd (see comment in
# main() for why they're not `local`).
restart_indexer() {
  # Skip if main() never got far enough to populate these — e.g. usage
  # error in parse_args. Avoids "unbound variable" on early exit.
  if [[ -z "${vm:-}" || -z "${zone:-}" || -z "${compose_cmd:-}" ]]; then
    return 0
  fi
  log_info "Restarting live indexer on ${vm}..."
  gcloud compute ssh "$vm" --project="$PROJECT" --zone="$zone" \
    --command="${compose_cmd} up -d vault-indexer" || true
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --project) PROJECT="${2:-}"; shift 2 ;;
      -h|--help) usage; exit 0 ;;
      *)         usage >&2; die "Unknown argument: $1" ;;
    esac
  done
  if [[ -z "$PROJECT" ]]; then
    PROJECT="$(terraform -chdir=terraform output -raw gcp_project_id 2>/dev/null || true)"
    [[ -n "$PROJECT" ]] || die "--project is required."
  fi
}

main() {
  parse_args "$@"
  # NOT `local`: the EXIT trap below fires *after* main() returns, at
  # which point any local var would be out of scope and `set -u` would
  # raise "unbound variable" before the trap can reach its SSH call —
  # which is exactly how the indexer was left stopped after a clean
  # backfill in an earlier version of this script. Script-scope vars
  # stay alive long enough for the trap to use them.
  vm="$(terraform -chdir=terraform output -raw instance_name 2>/dev/null || echo obsidian-sync)"
  zone="$(terraform -chdir=terraform output -raw gcp_zone 2>/dev/null || echo us-east1-b)"
  compose_cmd="cd /opt/obsidian && sudo docker compose -f docker-compose.yml -f docker-compose.indexer.yml"

  # Stop the long-running indexer for the duration of the backfill. Two
  # reasons:
  #   1. Memory — bge-small + ONNX runtime is ~300 MB per container.
  #      With the live indexer up AND a backfill container, plus CouchDB,
  #      a small VM swaps and SSH becomes glacial.
  #   2. Correctness — both processes write to the same vectors.db
  #      SQLite file. Letting backfill own the file exclusively avoids
  #      WAL contention and any window where the live indexer's writes
  #      race the backfill's bulk inserts.
  #
  # `trap` ensures we restart the live indexer even if the backfill
  # fails — leaving it stopped after a failed backfill would silently
  # break search.
  log_info "Stopping live indexer on ${vm} for backfill..."
  gcloud compute ssh "$vm" --project="$PROJECT" --zone="$zone" \
    --command="${compose_cmd} stop vault-indexer"

  trap restart_indexer EXIT

  log_info "Running backfill on ${vm}..."
  # `docker compose run --rm` spawns a one-shot container with the
  # indexer image, the same env file, and the same volumes as the
  # long-running service, but with backfill.js as the entrypoint.
  # Streams logs to the local terminal so progress is visible.
  #
  # --no-deps skips spinning up couchdb, which is already running as the
  # long-lived service.
  #
  # --ssh-flag=-tt forces TTY allocation. Without it, the remote SSH
  # session has no TTY, Node's stdout becomes block-buffered (64KB), and
  # console.log lines stay invisible for minutes. With a TTY, stdout is
  # line-buffered and each JSON log flushes on every \n.
  gcloud compute ssh "$vm" \
    --project="$PROJECT" \
    --zone="$zone" \
    --ssh-flag="-tt" \
    --command="${compose_cmd} run --rm --no-deps vault-indexer node dist/backfill.js"

  log_info "Backfill complete."
}

main "$@"
