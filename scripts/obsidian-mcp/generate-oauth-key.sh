#!/usr/bin/env bash
#
# Generate an RSA-2048 PKCS#8 PEM and push it as the latest version of the
# obsidian-mcp-oauth-signing-key Secret Manager secret. The MCP server
# uses this key to sign every JWT it mints (auth codes, access tokens,
# refresh tokens, the Google round-trip state).
#
# Idempotent in the sense that re-running creates a new key and a new
# secret version. Doing so invalidates every previously-issued token,
# because the kid changes (and validation fails). That's the recovery
# path on suspected token compromise.
#
# Usage:
#   scripts/obsidian-mcp/generate-oauth-key.sh --project <gcp-project>
#
# Requirements:
#   - openssl (any modern version; we use `genpkey -algorithm RSA`)
#   - gcloud, authenticated to a principal with secretmanager.secretVersionAdder
#     on the obsidian-mcp-oauth-signing-key secret.

set -euo pipefail

# shellcheck source=../lib/common.sh
source "$(dirname "$0")/../lib/common.sh"

PROJECT=""
SECRET="obsidian-mcp-oauth-signing-key"

usage() {
  cat <<EOF
Usage: $(basename "$0") --project <gcp-project> [--secret <secret-id>]

Generates an RSA-2048 PKCS#8 private key and pushes it as a new version
of the OAuth signing-key secret in Secret Manager. Output of openssl is
piped directly into gcloud; the key never lands on disk.

Required:
  --project <id>     GCP project ID.

Optional:
  --secret <id>      Secret Manager secret ID (default: ${SECRET}).
  -h, --help         Show this help.
EOF
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --project) PROJECT="${2:-}"; shift 2 ;;
      --secret)  SECRET="${2:-}"; shift 2 ;;
      -h|--help) usage; exit 0 ;;
      *)         usage >&2; die "Unknown argument: $1" ;;
    esac
  done
  [[ -n "$PROJECT" ]] || die "--project is required."
}

main() {
  parse_args "$@"

  command -v openssl >/dev/null || die "openssl is required."
  command -v gcloud  >/dev/null || die "gcloud is required."

  log_info "Generating RSA-2048 PKCS#8 PEM and pushing to secret '${SECRET}' in project '${PROJECT}'..."

  # `openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048` emits
  # PKCS#8 PEM by default (-----BEGIN PRIVATE KEY-----), which is what
  # jose's importPKCS8 expects. PKCS#1 (BEGIN RSA PRIVATE KEY) would
  # fail at server boot.
  if ! openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 \
      | gcloud secrets versions add "$SECRET" \
          --project="$PROJECT" --data-file=- ; then
    die "Failed to generate or upload the signing key. Check that the secret exists (terraform apply) and that you have secretmanager.secretVersionAdder."
  fi

  log_info "New signing key uploaded. The Cloud Run service must be restarted to pick it up:"
  cat <<EOF

  gcloud run services update obsidian-mcp \\
    --project=${PROJECT} --region=<region> \\
    --update-env-vars=BUMP=\$(date +%s)

EOF

  log_info "Note: every previously-issued token (access + refresh) is now invalid."
  log_info "Connected Claude clients will need to re-authenticate."
}

main "$@"
