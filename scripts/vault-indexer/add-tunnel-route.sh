#!/usr/bin/env bash
#
# Add an ingress rule for `indexer.<domain>` to the cloudflared config
# on the Phase 1 VM, in front of the catch-all 404. Reloads cloudflared
# afterwards. Idempotent — if the rule is already present, exits 0.
#
# Phase 1 manages cloudflared via setup-tunnel.sh on the VM. That script
# writes /etc/cloudflared/config.yml (system-scope, owned by root) and
# installs cloudflared as a systemd service that reads from there. We
# edit the same file rather than introducing a parallel user-scope
# config, so all tunnel ingress lives in one place on the VM.
#
# Trust model:
#   - Cloudflare Access (managed in Terraform) only admits requests
#     carrying the MCP-to-indexer service token.
#   - The indexer's own bearer-token check is the second layer.
#   - cloudflared on the VM is the only thing reachable from the
#     hostname; it forwards to http://127.0.0.1:8081 locally.
#
# Usage:
#   scripts/vault-indexer/add-tunnel-route.sh --project <gcp-project> [--domain <domain>]

set -euo pipefail

# shellcheck source=../lib/common.sh
source "$(dirname "$0")/../lib/common.sh"

PROJECT=""
DOMAIN=""
SUBDOMAIN="indexer"

usage() {
  cat <<EOF
Usage: $(basename "$0") [--project <id>] [--domain <domain>] [--subdomain indexer]

Adds an ingress rule for <subdomain>.<domain> → http://127.0.0.1:8081
to the cloudflared config on the Phase 1 VM, in front of the catch-all.

Idempotent: re-running with the same hostname is a no-op.

Options:
  --project <id>      GCP project ID (defaults to terraform output).
  --domain <domain>   Apex domain (defaults to terraform output domain).
  --subdomain <s>     Subdomain to add (default: indexer).
  -h, --help          Show this help.
EOF
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --project)   PROJECT="${2:-}"; shift 2 ;;
      --domain)    DOMAIN="${2:-}"; shift 2 ;;
      --subdomain) SUBDOMAIN="${2:-}"; shift 2 ;;
      -h|--help)   usage; exit 0 ;;
      *)           usage >&2; die "Unknown argument: $1" ;;
    esac
  done
  [[ -n "$PROJECT" ]] || PROJECT="$(terraform -chdir=terraform output -raw gcp_project_id 2>/dev/null || true)"
  [[ -n "$PROJECT" ]] || die "--project is required."
  if [[ -z "$DOMAIN" ]]; then
    # The domain isn't an output today; grep it out of tfvars as a
    # convenience, or require --domain.
    DOMAIN="$(grep -E '^[[:space:]]*domain[[:space:]]*=' terraform/terraform.tfvars 2>/dev/null \
              | head -1 \
              | sed -E 's/.*=[[:space:]]*"([^"]+)"/\1/' || true)"
  fi
  [[ -n "$DOMAIN" ]] || die "--domain is required (could not parse from terraform/terraform.tfvars)."
}

main() {
  parse_args "$@"
  local vm zone
  vm="$(terraform -chdir=terraform output -raw instance_name 2>/dev/null || echo obsidian-sync)"
  zone="$(terraform -chdir=terraform output -raw gcp_zone 2>/dev/null || echo us-east1-b)"
  local host="${SUBDOMAIN}.${DOMAIN}"

  log_info "Adding ingress rule for ${host} → http://127.0.0.1:8081 on ${vm}..."
  # /etc/cloudflared/config.yml is root-owned; sudo for both reads and
  # writes defensively. We edit the YAML structurally via Python +
  # PyYAML (mirrors what scripts/obsidian-mcp/remove-tunnel-hostname.sh
  # does for symmetry) rather than text-munging: an earlier awk version
  # of this script broke if the file's list indentation didn't match
  # the awk inserter's hardcoded two-space indent, and "did not find
  # expected key" YAML errors on validate are too easy to produce that
  # way.
  #
  # The catch-all entry (`{service: http_status:404}` with no hostname)
  # MUST stay last, so we insert the new rule immediately before it.
  local edit_script
  edit_script=$(cat <<'PYEOF'
import os, sys, tempfile, shutil, yaml
host = os.environ["HOST"]
cfg_path = "/etc/cloudflared/config.yml"
with open(cfg_path) as f:
    cfg = yaml.safe_load(f)
ingress = cfg.get("ingress", [])
# Idempotent: bail if a rule with this hostname is already present.
if any(r.get("hostname") == host for r in ingress):
    print(f"rule for {host} already present; nothing to do")
    sys.exit(0)
# Find the catch-all (no hostname field) and insert just before it.
# Fall back to appending if there's no catch-all, which would be
# unusual for a Phase 1 config but worth handling.
new_rule = {"hostname": host, "service": "http://127.0.0.1:8081"}
catch_idx = next(
    (i for i, r in enumerate(ingress) if "hostname" not in r),
    len(ingress),
)
ingress.insert(catch_idx, new_rule)
cfg["ingress"] = ingress
fd, tmp = tempfile.mkstemp(prefix="cloudflared-config.", suffix=".yml")
with os.fdopen(fd, "w") as f:
    yaml.safe_dump(cfg, f, default_flow_style=False, sort_keys=False)
shutil.move(tmp, cfg_path)
os.chmod(cfg_path, 0o644)
print(f"added rule for {host} to {cfg_path}")
PYEOF
)

  gcloud compute ssh "$vm" \
    --project="$PROJECT" \
    --zone="$zone" \
    --command="
set -euo pipefail
if ! sudo test -f /etc/cloudflared/config.yml; then
  echo 'cloudflared config not found at /etc/cloudflared/config.yml — has Phase 1 setup-tunnel.sh been run?' >&2
  exit 1
fi
if ! python3 -c 'import yaml' 2>/dev/null; then
  sudo apt-get update -y && sudo apt-get install -y python3-yaml
fi
# Backup BEFORE the edit — the Python writer is atomic via tempfile +
# shutil.move, but a backup keeps a recovery path if PyYAML reformats
# something unexpectedly.
sudo cp /etc/cloudflared/config.yml /etc/cloudflared/config.yml.bak.\$(date +%s)
sudo HOST='${host}' python3 <<'PYEND'
${edit_script}
PYEND

# Validate before reloading: a malformed config would crash cloudflared
# on reload and take the existing vault.<domain> route down with it.
if ! sudo cloudflared tunnel ingress validate; then
  echo 'cloudflared ingress validate failed; config left in place for inspection' >&2
  exit 1
fi

# Reload cloudflared (systemd unit name varies; try both common ones).
if systemctl is-active --quiet cloudflared; then
  sudo systemctl reload cloudflared || sudo systemctl restart cloudflared
elif systemctl is-active --quiet cloudflared.service; then
  sudo systemctl reload cloudflared.service || sudo systemctl restart cloudflared.service
else
  echo 'cloudflared service not running; start it manually' >&2
  exit 1
fi

echo \"reloaded cloudflared with new ingress rule for ${host}\"
"

  cat <<EOF

────────────────────────────────────────────────────────────────────────
Tunnel route for ${host} is now live.

Verify (from your workstation):
  # No Access service token → 403 from Cloudflare:
  curl -i https://${host}/health

  # With Access service token → 200 from the indexer:
  CF_ID=\$(gcloud secrets versions access latest --project=${PROJECT} \\
    --secret=vault-indexer-cf-access-client-id)
  CF_SECRET=\$(gcloud secrets versions access latest --project=${PROJECT} \\
    --secret=vault-indexer-cf-access-client-secret)
  curl -i -H "CF-Access-Client-Id: \$CF_ID" \\
          -H "CF-Access-Client-Secret: \$CF_SECRET" \\
          https://${host}/health
────────────────────────────────────────────────────────────────────────
EOF
}

main "$@"
