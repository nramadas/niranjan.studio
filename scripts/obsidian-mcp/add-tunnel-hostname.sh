#!/usr/bin/env bash
#
# Adds a second ingress rule to the Phase 1 cloudflared config so the
# existing tunnel routes mcp.<domain> to the Cloud Run service URL. Run
# AFTER the Cloud Run service exists (terraform apply) — the script needs
# the URL to point at.
#
# Why scripted: cloudflared on the VM is the source of truth for ingress
# rules. We could shell out to Cloudflare's API to manage the tunnel
# configuration centrally, but that's a separate code path from the Phase 1
# tunnel that's already working — keeping both ingress rules in
# /etc/cloudflared/config.yml keeps a single mental model.
#
# Idempotent: re-running on an already-configured VM updates the
# Cloud Run target and reloads cloudflared. The script only edits the
# `mcp.<domain>` rule; the `vault.<domain>` rule from Phase 1 is preserved.
#
# Usage:
#   scripts/obsidian-mcp/add-tunnel-hostname.sh \
#     --project <gcp-project> \
#     --zone <gcp-zone> \
#     --instance <vm-name> \
#     --domain <domain> \
#     [--mcp-subdomain mcp] \
#     [--region <gcp-region>]    # Cloud Run region, defaults to us-east1

set -euo pipefail

# shellcheck source=../lib/common.sh
source "$(dirname "$0")/../lib/common.sh"

PROJECT=""
ZONE=""
INSTANCE=""
DOMAIN=""
MCP_SUBDOMAIN="mcp"
REGION="us-east1"

usage() {
  cat <<EOF
Usage: $(basename "$0") --project <id> --zone <zone> --instance <name> --domain <domain> [options]

Adds a 'mcp.<domain>' ingress rule to /etc/cloudflared/config.yml on the
Phase 1 VM, pointing at the Cloud Run service URL, and reloads the
cloudflared systemd unit. The existing 'vault.<domain>' rule is preserved.

Required:
  --project <id>          GCP project ID.
  --zone <zone>           VM zone, e.g. us-east1-b.
  --instance <name>       VM name (default: obsidian-sync — pass --instance to override).
  --domain <domain>       Apex domain, e.g. niranjan.studio.

Optional:
  --mcp-subdomain <sub>   Hostname prefix (default: mcp).
  --region <region>       Cloud Run region (default: us-east1).
  -h, --help              Show this help.
EOF
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --project)       PROJECT="${2:-}"; shift 2 ;;
      --zone)          ZONE="${2:-}"; shift 2 ;;
      --instance)      INSTANCE="${2:-}"; shift 2 ;;
      --domain)        DOMAIN="${2:-}"; shift 2 ;;
      --mcp-subdomain) MCP_SUBDOMAIN="${2:-}"; shift 2 ;;
      --region)        REGION="${2:-}"; shift 2 ;;
      -h|--help)       usage; exit 0 ;;
      *)               usage >&2; die "Unknown argument: $1" ;;
    esac
  done

  [[ -n "$PROJECT" ]]  || die "--project is required."
  [[ -n "$ZONE" ]]     || die "--zone is required."
  [[ -n "$INSTANCE" ]] || die "--instance is required."
  [[ -n "$DOMAIN" ]]   || die "--domain is required."
}

main() {
  parse_args "$@"

  command -v gcloud >/dev/null || die "gcloud CLI is required."

  log_info "Looking up Cloud Run URL for service 'obsidian-mcp' in ${REGION}..."
  local cloud_run_url
  cloud_run_url=$(gcloud run services describe obsidian-mcp \
    --project="$PROJECT" --region="$REGION" --format='value(status.url)')
  [[ -n "$cloud_run_url" ]] || die "Could not resolve Cloud Run URL. Has terraform apply been run?"
  log_info "Cloud Run URL: ${cloud_run_url}"

  local mcp_hostname="${MCP_SUBDOMAIN}.${DOMAIN}"
  log_info "Will add ingress rule: ${mcp_hostname} → ${cloud_run_url}"

  # Build the Python snippet that surgically edits config.yml:
  #   - Loads the existing YAML.
  #   - Adds or updates the mcp ingress rule (matching by hostname).
  #   - Preserves all other rules and the catch-all 404.
  #   - Sets noTLSVerify to false (Cloud Run terminates TLS with a real cert).
  #   - Writes back atomically.
  #
  # Python is on the VM (cloud-init's image), and PyYAML usually is too.
  # If not, we apt-install it.
  local edit_script
  edit_script=$(cat <<'PYEOF'
import os, sys, shutil, tempfile, yaml
host = os.environ["MCP_HOSTNAME"]
target = os.environ["CLOUD_RUN_URL"]
cfg_path = "/etc/cloudflared/config.yml"
with open(cfg_path) as f:
    cfg = yaml.safe_load(f)
ingress = cfg.get("ingress", [])
new_rule = {
    "hostname": host,
    "service": target,
    "originRequest": {"noTLSVerify": False, "httpHostHeader": target.replace("https://", "")},
}
# Strip any prior rule for the same hostname.
ingress = [r for r in ingress if r.get("hostname") != host]
# Insert the new rule before the catch-all (last rule has no `hostname`).
catchall_idx = next(
    (i for i, r in enumerate(ingress) if "hostname" not in r),
    len(ingress),
)
ingress.insert(catchall_idx, new_rule)
cfg["ingress"] = ingress
fd, tmp = tempfile.mkstemp(prefix="cloudflared-config.", suffix=".yml")
with os.fdopen(fd, "w") as f:
    yaml.safe_dump(cfg, f, default_flow_style=False, sort_keys=False)
shutil.move(tmp, cfg_path)
print(f"Updated {cfg_path}: {host} -> {target}")
PYEOF
)

  log_info "Editing /etc/cloudflared/config.yml on ${INSTANCE}..."
  gcloud compute ssh "$INSTANCE" --project="$PROJECT" --zone="$ZONE" --command="
    set -euo pipefail
    if ! python3 -c 'import yaml' 2>/dev/null; then
      sudo apt-get update -y && sudo apt-get install -y python3-yaml
    fi
    sudo MCP_HOSTNAME='${mcp_hostname}' CLOUD_RUN_URL='${cloud_run_url}' \
      python3 <<'PYEND'
$edit_script
PYEND
    sudo cloudflared tunnel ingress validate || {
      echo 'Ingress validation failed — config left in place for inspection.' >&2
      exit 1
    }
    sudo systemctl reload cloudflared || sudo systemctl restart cloudflared
    sleep 2
    sudo systemctl is-active --quiet cloudflared
  " || die "Failed to edit config or reload cloudflared. Check 'sudo journalctl -u cloudflared'."

  log_info "cloudflared reloaded with the new ingress rule."

  cat <<EOF

────────────────────────────────────────────────────────────────────────
${mcp_hostname} now routes to ${cloud_run_url}.

Verify (after Cloudflare DNS propagates, usually < 30 seconds):

  curl -i https://${mcp_hostname}/healthz

Expected: HTTP/2 401 from Cloudflare Access if the Access policy is up,
or HTTP/2 200 (with {"ok": true}) if Access has not been configured yet.
A 530 means the tunnel didn't reach the origin — re-check the cloudflared
logs on the VM.
────────────────────────────────────────────────────────────────────────
EOF
}

main "$@"
