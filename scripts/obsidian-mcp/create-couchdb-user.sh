#!/usr/bin/env bash
#
# Provisions the CouchDB user the MCP server uses to talk to the Phase 1
# vault. The user has RW on a single database (the Obsidian one) and no
# admin privileges — a compromised Cloud Run revision should never be able
# to drop the database or rotate the admin password.
#
# Run this once after the Phase 1 vault is up AND after `terraform apply`
# has created the obsidian-mcp-couchdb-password secret. Re-running is safe;
# the script PUTs the user document with the latest password from Secret
# Manager.
#
# Usage:
#   scripts/obsidian-mcp/create-couchdb-user.sh \
#     --project <gcp-project> \
#     --domain <domain> \
#     [--vault-subdomain vault] \
#     [--db-name obsidian] \
#     [--mcp-user obsidian-mcp]
#
# The CouchDB admin password is read from Secret Manager (the Phase 1
# secret obsidian-couchdb-password). Your gcloud principal needs
# secretmanager.secretAccessor on it.

set -euo pipefail

# shellcheck source=../lib/common.sh
source "$(dirname "$0")/../lib/common.sh"

PROJECT=""
DOMAIN=""
VAULT_SUBDOMAIN="vault"
DB_NAME="obsidian"
MCP_USER="obsidian-mcp"
ADMIN_USER="obsidian"

usage() {
  cat <<EOF
Usage: $(basename "$0") --project <gcp-project> --domain <domain> [options]

Creates a CouchDB user named '${MCP_USER}' (or whatever --mcp-user sets) in
the Phase 1 CouchDB instance and grants it RW on a single database. The
user's password is fetched from Secret Manager (obsidian-mcp-couchdb-password,
created by Terraform).

Required:
  --project <id>           GCP project ID hosting both secrets.
  --domain <domain>        Apex domain, e.g. niranjan.studio.

Optional:
  --vault-subdomain <sub>  Phase 1 hostname prefix (default: vault).
  --db-name <name>         CouchDB database to grant RW on (default: obsidian).
  --mcp-user <user>        CouchDB username for the MCP server (default: obsidian-mcp).
  --admin-user <user>      Phase 1 admin username (default: obsidian).
  -h, --help               Show this help.
EOF
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --project)         PROJECT="${2:-}"; shift 2 ;;
      --domain)          DOMAIN="${2:-}"; shift 2 ;;
      --vault-subdomain) VAULT_SUBDOMAIN="${2:-}"; shift 2 ;;
      --db-name)         DB_NAME="${2:-}"; shift 2 ;;
      --mcp-user)        MCP_USER="${2:-}"; shift 2 ;;
      --admin-user)      ADMIN_USER="${2:-}"; shift 2 ;;
      -h|--help)         usage; exit 0 ;;
      *)                 usage >&2; die "Unknown argument: $1" ;;
    esac
  done

  [[ -n "$PROJECT" ]] || { usage >&2; die "--project is required."; }
  [[ -n "$DOMAIN" ]]  || { usage >&2; die "--domain is required."; }
}

main() {
  parse_args "$@"

  command -v gcloud >/dev/null || die "gcloud CLI is required."
  command -v curl   >/dev/null || die "curl is required."
  command -v jq     >/dev/null || die "jq is required (brew install jq)."

  local vault_url="https://${VAULT_SUBDOMAIN}.${DOMAIN}"

  log_info "Fetching Phase 1 admin password from Secret Manager..."
  local admin_pw
  admin_pw=$(gcloud secrets versions access latest \
    --project="$PROJECT" --secret=obsidian-couchdb-password)

  log_info "Fetching MCP server password from Secret Manager..."
  local mcp_pw
  mcp_pw=$(gcloud secrets versions access latest \
    --project="$PROJECT" --secret=obsidian-mcp-couchdb-password)

  local admin_auth="${ADMIN_USER}:${admin_pw}"

  log_info "Verifying admin credentials against ${vault_url}..."
  curl -sf -u "$admin_auth" "${vault_url}/_up" >/dev/null \
    || die "Admin auth failed. Confirm Phase 1 is up and the admin password is correct."

  log_info "Creating user '${MCP_USER}' in _users (PUT /_users/org.couchdb.user:${MCP_USER})..."
  # CouchDB stores users as docs in /_users with _id of org.couchdb.user:<name>.
  # PUT is idempotent if we read the current _rev first; on first run there's
  # no doc, so we tolerate a 404 and PUT without _rev.
  local user_doc_id="org.couchdb.user:${MCP_USER}"
  local existing_rev
  existing_rev=$(
    curl -s -u "$admin_auth" "${vault_url}/_users/${user_doc_id}" \
      | jq -r '._rev // empty'
  )

  local body
  if [[ -n "$existing_rev" ]]; then
    body=$(jq -nc \
      --arg id   "$user_doc_id" \
      --arg rev  "$existing_rev" \
      --arg name "$MCP_USER" \
      --arg pw   "$mcp_pw" \
      '{_id:$id, _rev:$rev, name:$name, password:$pw, roles:[], type:"user"}')
  else
    body=$(jq -nc \
      --arg id   "$user_doc_id" \
      --arg name "$MCP_USER" \
      --arg pw   "$mcp_pw" \
      '{_id:$id, name:$name, password:$pw, roles:[], type:"user"}')
  fi

  curl -sf -u "$admin_auth" \
    -X PUT \
    -H 'Content-Type: application/json' \
    --data-raw "$body" \
    "${vault_url}/_users/${user_doc_id}" >/dev/null \
    || die "Failed to create/update CouchDB user '${MCP_USER}'."

  log_info "Granting '${MCP_USER}' RW on database '${DB_NAME}' via _security..."
  # _security is per-database. Members can read/write docs; admins can also
  # change the _security doc itself. We add the MCP user as a member, NOT
  # an admin — so a compromised MCP server can't elevate further.
  local security_doc
  security_doc=$(jq -nc \
    --arg name "$MCP_USER" \
    '{admins:{names:[],roles:[]}, members:{names:[$name],roles:[]}}')

  curl -sf -u "$admin_auth" \
    -X PUT \
    -H 'Content-Type: application/json' \
    --data-raw "$security_doc" \
    "${vault_url}/${DB_NAME}/_security" >/dev/null \
    || die "Failed to set _security on database '${DB_NAME}'."

  log_info "Verifying '${MCP_USER}' can authenticate and read '${DB_NAME}'..."
  curl -sf -u "${MCP_USER}:${mcp_pw}" \
    "${vault_url}/${DB_NAME}" >/dev/null \
    || die "MCP user authentication or DB read failed."

  cat <<EOF

────────────────────────────────────────────────────────────────────────
CouchDB user '${MCP_USER}' is provisioned and has RW access on '${DB_NAME}'.

The Cloud Run service uses these credentials automatically (mounted from
Secret Manager). No further action required for the user; next step is
populating the LiveSync passphrase secret and deploying the service.
────────────────────────────────────────────────────────────────────────
EOF
}

main "$@"
