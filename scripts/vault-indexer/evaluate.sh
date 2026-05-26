#!/usr/bin/env bash
#
# Run the embedding-model evaluation harness. For each model in
# --models, spins up a one-shot indexer container against a per-model
# side-store, backfills it from the live vault, runs the fixed query
# set, and prints results side-by-side for human comparison.
#
# Side-stores live at /var/lib/vault-indexer/vectors.db.eval-<model>.db
# on the VM and are dropped after the run.
#
# Usage:
#   scripts/vault-indexer/evaluate.sh --project <id> \
#     [--models bge-small,openai-small] \
#     [--queries-file path/on/vm/queries.txt] \
#     [--top-k 5]

set -euo pipefail

# shellcheck source=../lib/common.sh
source "$(dirname "$0")/../lib/common.sh"

PROJECT=""
MODELS="bge-small,openai-small"
QUERIES_FILE="/opt/vault-indexer/eval/queries.txt"
TOP_K=5

usage() {
  cat <<EOF
Usage: $(basename "$0") --project <id> [--models bge-small,openai-small] [--queries-file path] [--top-k 5]

Runs the embedding-model evaluation harness on the e2-micro VM.

Each model gets a side-store backfill, then the query set is run, and
results are printed side-by-side per query. Side-stores are removed
afterwards.

Options:
  --project <id>         GCP project ID (defaults to terraform output).
  --models <a,b>         Comma-separated model list (default: bge-small,openai-small).
                         Valid: bge-small, openai-small, openai-large.
  --queries-file <path>  Path INSIDE the container (mounted from VM).
                         Default: /opt/vault-indexer/eval/queries.txt
                         (image-baked queries file).
  --top-k <n>            Hits per query (default: 5).
  -h, --help             Show this help.

Note: OpenAI models require the vault-indexer-openai-key secret to be
populated. The default placeholder will cause those models to fail
clearly — that's by design; populate the secret before running an
OpenAI comparison.
EOF
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --project)       PROJECT="${2:-}"; shift 2 ;;
      --models)        MODELS="${2:-}"; shift 2 ;;
      --queries-file)  QUERIES_FILE="${2:-}"; shift 2 ;;
      --top-k)         TOP_K="${2:-}"; shift 2 ;;
      -h|--help)       usage; exit 0 ;;
      *)               usage >&2; die "Unknown argument: $1" ;;
    esac
  done
  [[ -n "$PROJECT" ]] || PROJECT="$(terraform -chdir=terraform output -raw gcp_project_id 2>/dev/null || true)"
  [[ -n "$PROJECT" ]] || die "--project is required."
}

main() {
  parse_args "$@"
  local vm zone
  vm="$(terraform -chdir=terraform output -raw instance_name 2>/dev/null || echo obsidian-sync)"
  zone="$(terraform -chdir=terraform output -raw gcp_zone 2>/dev/null || echo us-east1-b)"

  log_info "Running eval on ${vm} (models=${MODELS}, top-k=${TOP_K})..."

  # See run-backfill.sh for why --ssh-flag=-tt is required (TTY → stdout
  # line-buffered → live JSON log streaming).
  gcloud compute ssh "$vm" \
    --project="$PROJECT" \
    --zone="$zone" \
    --ssh-flag="-tt" \
    --command="cd /opt/obsidian && sudo docker compose -f docker-compose.yml -f docker-compose.indexer.yml run --rm --no-deps \
      -e EVAL_MODELS=${MODELS} \
      -e EVAL_QUERIES_FILE=${QUERIES_FILE} \
      -e EVAL_TOP_K=${TOP_K} \
      vault-indexer node dist/eval.js"

  log_info "Cleaning up per-model side-stores..."
  gcloud compute ssh "$vm" \
    --project="$PROJECT" \
    --zone="$zone" \
    --command="sudo rm -f /opt/vault-indexer/data/vectors.db.eval-*.db" || true

  log_info "Eval complete."
}

main "$@"
