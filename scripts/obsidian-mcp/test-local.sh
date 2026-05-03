#!/usr/bin/env bash
#
# Runs the obsidian-mcp server locally against the production CouchDB
# (the Phase 1 vault). Useful for iterating on tools or debugging an issue
# without rolling a Cloud Run revision.
#
# Reads .env.local from the service directory — copy .env.example and fill
# it in first.
#
# Usage:
#   scripts/obsidian-mcp/test-local.sh             # run the server
#   scripts/obsidian-mcp/test-local.sh --probe     # also POST a tools/list
#
# The --probe path mints a short-lived access token using the same
# OAUTH_SIGNING_KEY the server uses, so we can hit /mcp without going
# through the full OAuth + Google dance. This sidesteps Google for local
# iteration; the production flow always goes through the real OAuth path.

set -euo pipefail

# shellcheck source=../lib/common.sh
source "$(dirname "$0")/../lib/common.sh"

PROBE=false

usage() {
  cat <<EOF
Usage: $(basename "$0") [--probe]

Runs the local dev server (npm run dev) reading services/obsidian-mcp/.env.local.

  --probe   After the server is up, mint a local access token signed with
            the .env.local OAUTH_SIGNING_KEY and POST a tools/list request
            so you can see the registered tools without the full OAuth dance.
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

mint_local_token() {
  # Inline node + jose to sign a short-lived access token using the same
  # signing key the server is running with. The payload mirrors what
  # encodeAccessToken would produce.
  local issuer="$1" sub="$2"
  ( cd "$service_dir" && OAUTH_ISSUER="$issuer" SUB="$sub" node --input-type=module -e '
import { importPKCS8, SignJWT, calculateJwkThumbprint, exportJWK } from "jose";
const pem = process.env.OAUTH_SIGNING_KEY;
if (!pem) { console.error("OAUTH_SIGNING_KEY not set in env"); process.exit(1); }
const key = await importPKCS8(pem, "RS256", { extractable: true });
const jwk = await exportJWK(key);
for (const k of ["d","p","q","dp","dq","qi"]) delete jwk[k];
jwk.alg = "RS256"; jwk.use = "sig";
const kid = await calculateJwkThumbprint(jwk);
const iss = process.env.OAUTH_ISSUER;
const now = Math.floor(Date.now()/1000);
const jwt = await new SignJWT({ type: "access_token", sub: process.env.SUB, iss, aud: iss })
  .setProtectedHeader({ alg: "RS256", kid })
  .setIssuedAt(now)
  .setExpirationTime(now + 300)
  .sign(key);
process.stdout.write(jwt);
' )
}

if $PROBE; then
  log_info "Starting server in the background; will probe in ~3 seconds."
  ( cd "$service_dir" && set -a; . ./.env.local; set +a; npm run dev ) &
  server_pid=$!
  trap 'kill $server_pid 2>/dev/null || true' EXIT INT TERM
  sleep 3
  port="${PORT:-8080}"
  set -a
  # shellcheck disable=SC1091
  . "${service_dir}/.env.local"
  set +a
  iss="${OAUTH_ISSUER:-http://localhost:${port}}"
  sub="${ALLOWED_EMAILS%%,*}"
  [[ -n "$sub" ]] || die "ALLOWED_EMAILS missing in .env.local; cannot mint a probe token."

  log_info "GET /health"
  curl -sf "http://localhost:${port}/health" || log_warn "Health check failed."
  echo

  log_info "GET /.well-known/oauth-authorization-server"
  curl -s "http://localhost:${port}/.well-known/oauth-authorization-server" | head -c 400
  echo

  log_info "Minting a local access token for ${sub}..."
  token="$(mint_local_token "$iss" "$sub")"

  log_info "POST /mcp tools/list"
  curl -s -X POST "http://localhost:${port}/mcp" \
    -H "Authorization: Bearer ${token}" \
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
