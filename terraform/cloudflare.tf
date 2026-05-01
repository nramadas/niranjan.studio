# ─── Cloudflare DNS for the Obsidian vault ──────────────────────────────────
#
# The tunnel itself is created manually on the VM via setup-tunnel.sh — the
# credentials-file dance for a single tunnel isn't worth automating, and
# `cloudflared tunnel login` requires a browser login flow.
#
# That manual step produces a tunnel UUID. Plug it into terraform.tfvars
# (cloudflare_tunnel_id) and apply again to get the DNS record.

data "cloudflare_zone" "main" {
  name = var.domain
}

# CNAME to <tunnel-id>.cfargotunnel.com is how Cloudflare routes traffic into
# the tunnel. `proxied = true` is required — otherwise the CNAME resolves to
# Cloudflare's argo edge but the proxy isn't engaged.
#
# The `count` is what makes this skip on first apply: leave
# cloudflare_tunnel_id empty until the tunnel exists, then re-apply.

resource "cloudflare_record" "vault" {
  count = var.cloudflare_tunnel_id == "" ? 0 : 1

  zone_id = data.cloudflare_zone.main.id
  name    = var.vault_subdomain
  content = "${var.cloudflare_tunnel_id}.cfargotunnel.com"
  type    = "CNAME"
  proxied = true
  ttl     = 1 # ttl=1 means "Auto", required when proxied
  comment = "Cloudflare Tunnel target for self-hosted Obsidian CouchDB"
}
