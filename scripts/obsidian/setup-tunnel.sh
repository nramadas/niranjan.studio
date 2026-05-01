#!/usr/bin/env bash
#
# Run this on the Obsidian VM after first boot to create the Cloudflare tunnel.
# Why not in Terraform: `cloudflared tunnel login` is a browser-based OAuth flow
# that emits a long-lived cert.pem; automating one tunnel isn't worth the dance.
#
# What this script does:
#   1. Installs cloudflared from Cloudflare's official apt repo.
#   2. Tells you to run `cloudflared tunnel login` (you do this once,
#      interactively, opens a browser).
#   3. Creates a tunnel called `obsidian` (or detects an existing one).
#   4. Writes /etc/cloudflared/config.yml routing vault.<domain> → :5984.
#   5. Installs and starts the cloudflared systemd service.
#   6. Prints the tunnel UUID — copy it into terraform.tfvars
#      (cloudflare_tunnel_id) and re-apply Terraform to create the DNS record.
#
# DNS record creation is intentionally NOT done here — Terraform manages it
# via cloudflare_record.vault. Don't run `cloudflared tunnel route dns`.
#
# Usage:
#   sudo ./setup-tunnel.sh --domain niranjan.studio [--vault-subdomain vault]

set -euo pipefail

# Helpers inlined rather than sourced from ../lib/common.sh — the script
# gets run from a variety of cwds (and under sudo), and `$(dirname "$0")`
# path resolution is fragile across all those. Keeping the helpers local
# means the script is the only file you need on the VM.

if [[ -t 1 ]] && [[ -z "${NO_COLOR:-}" ]]; then
  __c_reset=$'\033[0m'; __c_red=$'\033[31m'
  __c_yellow=$'\033[33m'; __c_blue=$'\033[34m'
else
  __c_reset=""; __c_red=""; __c_yellow=""; __c_blue=""
fi
log_info()  { printf '%s[info]%s %s\n'  "${__c_blue}"   "${__c_reset}" "$*"; }
log_warn()  { printf '%s[warn]%s %s\n'  "${__c_yellow}" "${__c_reset}" "$*" >&2; }
log_error() { printf '%s[error]%s %s\n' "${__c_red}"    "${__c_reset}" "$*" >&2; }
die()       { log_error "$@"; exit 1; }

TUNNEL_NAME="obsidian"
DOMAIN=""
VAULT_SUBDOMAIN="vault"

usage() {
  cat <<EOF
Usage: sudo $(basename "$0") --domain <domain> [--vault-subdomain <sub>]

Creates a Cloudflare tunnel called 'obsidian' that routes traffic for
<vault-subdomain>.<domain> into http://localhost:5984 on this VM.

Options:
  --domain <domain>          Apex domain registered at Cloudflare (required).
  --vault-subdomain <sub>    Hostname prefix (default: vault).
  -h, --help                 Show this help.
EOF
}

require_root() {
  if [[ $EUID -ne 0 ]]; then
    die "Run with sudo (the cloudflared service install needs root)."
  fi
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --domain)          DOMAIN="${2:-}"; shift 2 ;;
      --vault-subdomain) VAULT_SUBDOMAIN="${2:-}"; shift 2 ;;
      -h|--help)         usage; exit 0 ;;
      *)                 usage >&2; die "Unknown argument: $1" ;;
    esac
  done

  [[ -n "$DOMAIN" ]] || { usage >&2; die "--domain is required."; }
}

install_cloudflared() {
  if command -v cloudflared >/dev/null 2>&1; then
    log_info "cloudflared already installed: $(cloudflared --version 2>&1 | head -n1)"
    return
  fi

  log_info "Installing cloudflared from Cloudflare's apt repo..."
  mkdir -p --mode=0755 /usr/share/keyrings
  curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg \
    | tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null
  echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared $(lsb_release -cs) main" \
    > /etc/apt/sources.list.d/cloudflared.list
  apt-get update -y
  apt-get install -y cloudflared
}

require_login() {
  # cloudflared writes cert.pem to ~/.cloudflared after `tunnel login`.
  # We need the SUDO_USER's home to find it.
  local home_dir
  home_dir="$(eval echo "~${SUDO_USER:-$USER}")"
  if [[ ! -f "${home_dir}/.cloudflared/cert.pem" ]]; then
    cat <<EOF

cloudflared isn't logged in yet. Run this first (NOT as root):

    cloudflared tunnel login

That opens a browser to https://dash.cloudflare.com — pick the zone for
${DOMAIN} and authorise. It'll write ~/.cloudflared/cert.pem.

Then re-run this script.

EOF
    exit 1
  fi
  log_info "Found cert.pem at ${home_dir}/.cloudflared/cert.pem"
  CERT_HOME="${home_dir}"
}

create_tunnel() {
  # `cloudflared tunnel list --output json` returns JSON `null` (not `[]`)
  # when there are zero tunnels, so jq filters need `// []` to tolerate it.
  local jq_filter='(. // []) | .[] | select(.name==$n) | .id'

  local existing
  existing="$(sudo -u "${SUDO_USER:-$USER}" cloudflared tunnel list \
              --output json 2>/dev/null \
              | jq -r --arg n "$TUNNEL_NAME" "$jq_filter" \
              | head -n1)"

  if [[ -n "$existing" ]]; then
    log_warn "Tunnel '${TUNNEL_NAME}' already exists with ID ${existing}. Re-using."
    TUNNEL_ID="$existing"
  else
    log_info "Creating tunnel '${TUNNEL_NAME}'..."
    sudo -u "${SUDO_USER:-$USER}" cloudflared tunnel create "$TUNNEL_NAME"
    TUNNEL_ID="$(sudo -u "${SUDO_USER:-$USER}" cloudflared tunnel list \
                  --output json \
                  | jq -r --arg n "$TUNNEL_NAME" "$jq_filter" \
                  | head -n1)"
  fi

  [[ -n "$TUNNEL_ID" ]] || die "Failed to obtain tunnel ID."
  log_info "Tunnel ID: ${TUNNEL_ID}"
}

write_config() {
  log_info "Installing tunnel credentials and config to /etc/cloudflared/..."
  mkdir -p /etc/cloudflared
  cp "${CERT_HOME}/.cloudflared/${TUNNEL_ID}.json" "/etc/cloudflared/${TUNNEL_ID}.json"
  chmod 600 "/etc/cloudflared/${TUNNEL_ID}.json"

  cat > /etc/cloudflared/config.yml <<EOF
tunnel: ${TUNNEL_ID}
credentials-file: /etc/cloudflared/${TUNNEL_ID}.json

ingress:
  - hostname: ${VAULT_SUBDOMAIN}.${DOMAIN}
    service: http://localhost:5984
  - service: http_status:404
EOF
  chmod 644 /etc/cloudflared/config.yml
}

install_service() {
  log_info "Installing and starting the cloudflared systemd service..."
  # `cloudflared service install` reads /etc/cloudflared/config.yml.
  cloudflared service install || log_warn "Service may already be installed; continuing."
  systemctl enable cloudflared
  systemctl restart cloudflared
  sleep 2
  if systemctl is-active --quiet cloudflared; then
    log_info "cloudflared is active."
  else
    log_error "cloudflared failed to start. Inspect: journalctl -u cloudflared -n 50"
    exit 1
  fi
}

main() {
  parse_args "$@"
  require_root
  install_cloudflared
  require_login
  create_tunnel
  write_config
  install_service

  cat <<EOF

────────────────────────────────────────────────────────────────────────
Tunnel '${TUNNEL_NAME}' is up.

Tunnel ID: ${TUNNEL_ID}

Next:
  1. Add this ID to terraform.tfvars on your laptop:

       cloudflare_tunnel_id = "${TUNNEL_ID}"

  2. Re-run terraform apply. The cloudflare_record resource will create
     the CNAME ${VAULT_SUBDOMAIN}.${DOMAIN} → ${TUNNEL_ID}.cfargotunnel.com.

  3. Verify from your laptop:

       curl -i https://${VAULT_SUBDOMAIN}.${DOMAIN}/_up

     Expect HTTP 401 (CouchDB requires auth — that's success: the tunnel
     reached CouchDB).
────────────────────────────────────────────────────────────────────────
EOF
}

main "$@"
