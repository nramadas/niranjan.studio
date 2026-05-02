#!/usr/bin/env bash
#
# Runs the obsidian-mcp server locally against the production CouchDB
# (the Phase 1 vault). Useful for iterating on tools or debugging an issue
# without rolling a Cloud Run revision.
#
# Reads .env.local from the service directory — copy .env.example and fill
# it in first. The bearer token check still applies; the Cloudflare Access
# JWT check is skipped (AUTH_PROVIDER=disabled).
#
# Usage:
#   scripts/obsidian-mcp/test-local.sh             # run the server
#   scripts/obsidian-mcp/test-local.sh --probe     # also POST a tools/list

set -euo pipefail

# shellcheck source=../lib/common.sh
source "$(dirname "$0")/../lib/common.sh"

PROBE=false

usage() {
  cat <<EOF
Usage: $(basename "$0") [--probe]

Runs the local dev server (npm run dev) reading services/obsidian-mcp/.env.local.

  --probe   After the server is up, POST a tools/list request via curl so
            you can see the registered tools without needing a real client.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --probe)   PROBE=true; shift ;;
    -h|--help) usage; exit 0 ;;
    *)         usage >&2; die "Unknown argument: $1" ;;
  esac
done

repo_root="$(git -C "$(dirname "$0")/../.." rev-parse --show-toplevel)"
service_dir="${repo_root}/services/obsidian-mcp"

[[ -f "${service_dir}/.env.local" ]] \
  || die ".env.local not found in ${service_dir}. Copy .env.example and fill it in."

if $PROBE; then
  log_info "Starting server in the background; will probe in ~3 seconds."
  ( cd "$service_dir" && set -a; . ./.env.local; set +a; npm run dev ) &
  server_pid=$!
  trap 'kill $server_pid 2>/dev/null || true' EXIT INT TERM
  sleep 3
  port="${PORT:-8080}"
  bearer="$(grep '^MCP_BEARER_TOKEN=' "${service_dir}/.env.local" | cut -d= -f2-)"
  log_info "GET /healthz"
  curl -sf "http://localhost:${port}/healthz" || log_warn "Health check failed."
  log_info "POST /mcp tools/list"
  curl -s -X POST "http://localhost:${port}/mcp" \
    -H "Authorization: Bearer ${bearer}" \
    -H 'Content-Type: application/json' \
    -H 'Accept: application/json, text/event-stream' \
    --data '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' \
    | head -c 4000
  echo
  log_info "Server still running as PID ${server_pid} — Ctrl-C to stop."
  wait "$server_pid"
else
  cd "$service_dir"
  set -a
  # shellcheck disable=SC1091
  . ./.env.local
  set +a
  exec npm run dev
fi
