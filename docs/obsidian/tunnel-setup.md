# Cloudflare tunnel: the manual bits

The Cloudflare DNS record is in Terraform. The tunnel itself is not. This doc explains why, what `setup-tunnel.sh` does behind the scenes, and how to recover if you lose the credentials.

## Why the tunnel isn't in Terraform

You *can* manage tunnels with the Cloudflare provider's `cloudflare_tunnel` and `cloudflare_tunnel_config` resources. For one tunnel that's set up once and never touched, it's not worth it:

- The tunnel needs a credentials JSON on the VM. If Terraform creates the tunnel, Terraform has to either generate a tunnel secret and pass it in (writing it to state, then to the VM via metadata, where it'd appear in cloud-init logs and stay accessible to anyone with metadata read), or call out to `cloudflared` from a `local-exec` provisioner.
- `cloudflared tunnel login` is a browser flow that emits a long-lived `cert.pem`. That's a one-time human step regardless of where the tunnel resource lives.
- Diffing tunnel state against the VM's local state is a perpetual source of drift complaints in `terraform plan`.

For a single tunnel, manual on the VM is simpler. The DNS record stays in Terraform because the API token's already configured and DNS is the part that needs to match an external value (the tunnel ID).

If you ever have multiple tunnels, revisit this — at that point the boilerplate cost flips.

## What `setup-tunnel.sh` actually does

1. **Installs `cloudflared`** from Cloudflare's official apt repo. The Debian package wires up `/etc/cloudflared/` and the systemd unit template.
2. **Checks for `~/.cloudflared/cert.pem`.** If missing, prints instructions to run `cloudflared tunnel login` (NOT as root — the cert lives in your `$HOME`). On a headless VM, the login command prints a URL; you open it on a browser-equipped device, pick the zone, click authorise, and the cert lands on the VM.
3. **Creates the tunnel** named `obsidian` if it doesn't exist (or detects an existing one with that name and reuses it). Creation generates a credentials JSON named `<tunnel-id>.json` in `~/.cloudflared/`.
4. **Copies the credentials JSON to `/etc/cloudflared/`** so the systemd service (which runs as root) can read it.
5. **Writes `/etc/cloudflared/config.yml`** with a single ingress rule: `<vault-subdomain>.<domain>` → `http://localhost:5984`. A catch-all rule returns 404 for any other hostname routed through the tunnel.
6. **Installs and starts the systemd service**: `cloudflared service install` reads the config, then `systemctl enable --now cloudflared`.
7. **Prints the tunnel UUID** for you to paste into `terraform.tfvars`.

Notably, the script does **not** call `cloudflared tunnel route dns`. That command would create a CNAME via the Cloudflare API — which is exactly what Terraform's `cloudflare_record.vault` does. We do it via Terraform so the record is tracked in state.

## Recovering if you lose the credentials

There are three artefacts:

- **`cert.pem`**: the long-lived account cert. Lost: re-run `cloudflared tunnel login` to get a new one.
- **`<tunnel-id>.json`**: the per-tunnel credentials. Lost: cannot regenerate. Must delete and recreate the tunnel.
- **The tunnel itself** (registered at Cloudflare): visible at https://one.dash.cloudflare.com → Networks → Tunnels.

If you've lost `<tunnel-id>.json` only:

```
# On the VM, after cloudflared tunnel login:
cloudflared tunnel delete obsidian
cloudflared tunnel create obsidian
# Note the new ID. Copy <new-id>.json into /etc/cloudflared/.
# Update /etc/cloudflared/config.yml to reference the new ID.
sudo systemctl restart cloudflared
# Update terraform.tfvars cloudflare_tunnel_id and apply.
```

The DNS record will get updated by Terraform on the next apply.

If the entire VM is gone (you destroyed and recreated it), everything is regenerated from scratch — re-run `setup-tunnel.sh`. The old tunnel may still be registered at Cloudflare; clean it up with `cloudflared tunnel delete obsidian` from any machine that has a valid `cert.pem` for the account.

## Why a Cloudflare Tunnel and not Caddy + Let's Encrypt?

- **No inbound ports needed.** The VM's firewall has zero `ALLOW` rules for ingress. The only outbound dependency is Cloudflare's edge.
- **No certificate management.** Cloudflare terminates TLS at its edge using its own cert; the tunnel hop is encrypted via the tunnel protocol.
- **DDoS shielding** comes for free as a side effect of going through Cloudflare's network.
- **Origin discovery is impossible** without a Cloudflare-side leak. Caddy + LE puts your VM's public IP in CT logs forever the first time you provision a cert; tunnels don't.

The trade is one extra hop of latency. For Obsidian sync — small JSON over HTTP, infrequent — it's invisible.
