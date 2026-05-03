#!/usr/bin/env bash
#
# Removes the mcp.<domain> ingress rule from the Phase 1 cloudflared
# config on the VM. Use this once after migrating the MCP service away
# from Cloudflare to Cloud Run domain mapping — the cloudflared route
# is dead weight at that point and confuses anyone reading the config.
#
# Idempotent: re-running on a VM that doesn't have the rule is a no-op.
# The vault.<domain> rule from Phase 1 is preserved.
#
# Usage:
#   scripts/obsidian-mcp/remove-tunnel-hostname.sh \
#     --project <gcp-project> \
#     --zone <gcp-zone> \
#     --instance <vm-name> \
#     --domain <domain> \
#     [--mcp-subdomain mcp]

set -euo pipefail

# shellcheck source=../lib/common.sh
source "$(dirname "$0")/../lib/common.sh"

PROJECT=""
ZONE=""
INSTANCE=""
DOMAIN=""
MCP_SUBDOMAIN="mcp"

usage() {
  cat <<EOF
Usage: $(basename "$0") --project <id> --zone <zone> --instance <name> --domain <domain> [options]

Removes any 'mcp.<domain>' ingress rule from /etc/cloudflared/config.yml on
the Phase 1 VM and reloads the cloudflared systemd unit. The
'vault.<domain>' rule is preserved.

Required:
  --project <id>          GCP project ID.
  --zone <zone>           VM zone, e.g. us-east1-b.
  --instance <name>       VM name (default: obsidian-sync — pass --instance to override).
  --domain <domain>       Apex domain, e.g. niranjan.studio.

Optional:
  --mcp-subdomain <sub>   Hostname prefix to remove (default: mcp).
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

  local mcp_hostname="${MCP_SUBDOMAIN}.${DOMAIN}"
  log_info "Will remove ingress rule for: ${mcp_hostname}"

  local edit_script
  edit_script=$(cat <<'PYEOF'
import os, sys, shutil, tempfile, yaml
host = os.environ["MCP_HOSTNAME"]
cfg_path = "/etc/cloudflared/config.yml"
with open(cfg_path) as f:
    cfg = yaml.safe_load(f)
ingress = cfg.get("ingress", [])
before = len(ingress)
ingress = [r for r in ingress if r.get("hostname") != host]
after = len(ingress)
if before == after:
    print(f"No rule for {host} present; nothing to do.")
else:
    cfg["ingress"] = ingress
    fd, tmp = tempfile.mkstemp(prefix="cloudflared-config.", suffix=".yml")
    with os.fdopen(fd, "w") as f:
        yaml.safe_dump(cfg, f, default_flow_style=False, sort_keys=False)
    shutil.move(tmp, cfg_path)
    print(f"Removed rule for {host} from {cfg_path}.")
PYEOF
)

  log_info "Editing /etc/cloudflared/config.yml on ${INSTANCE}..."
  gcloud compute ssh "$INSTANCE" --project="$PROJECT" --zone="$ZONE" --command="
    set -euo pipefail
    if ! python3 -c 'import yaml' 2>/dev/null; then
      sudo apt-get update -y && sudo apt-get install -y python3-yaml
    fi
    sudo MCP_HOSTNAME='${mcp_hostname}' python3 <<'PYEND'
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

  log_info "cloudflared reloaded. ${mcp_hostname} no longer routes through the tunnel."
}

main "$@"
