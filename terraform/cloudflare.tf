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

# ─── MCP server hostname ────────────────────────────────────────────────────
#
# mcp.<domain> points directly at Google-hosted (ghs.googlehosted.com) so
# Cloud Run domain mapping can serve the cert. `proxied = false` — DNS-only,
# no Cloudflare in the request path. Cloudflare is still the DNS provider
# (so we keep one place to manage the zone) but the actual MCP traffic
# never traverses Cloudflare's edge.
#
# Why ghs.googlehosted.com: that's the canonical CNAME target Cloud Run
# domain mapping returns for a non-apex domain. (Apex domains require A/AAAA
# records pointing at Google's anycast IPs instead — we don't need that here.)

resource "cloudflare_record" "mcp" {
  zone_id = data.cloudflare_zone.main.id
  name    = var.mcp_subdomain
  content = "ghs.googlehosted.com"
  type    = "CNAME"
  proxied = false
  ttl     = 300
  comment = "Cloud Run domain mapping target for the Obsidian MCP service"
}
