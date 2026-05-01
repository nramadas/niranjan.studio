# Obsidian sync setup (Phase 1)

End-to-end walkthrough: from buying a domain to a working sync between Mac, iPad, and iPhone. Each step explains *why* it's there, what success looks like, and the most common failure mode.

Before you start, read these:

- **Free-tier eligibility is real money on the line.** The Terraform pins `e2-micro`, `pd-standard`, and `STANDARD` network tier. If you change any of those — even to `pd-balanced` — you start paying. Free tier also requires `us-east1`, `us-west1`, or `us-central1`; the variable validation enforces this.
- **Free tier is per billing account, not per project.** If your billing account already runs an `e2-micro` somewhere, this VM will not be free. Confirm with `gcloud compute instances list` across your projects before applying.
- **The CouchDB E2EE passphrase you'll set in step 13 is unrecoverable.** Save it to a password manager *before* enabling E2EE.

## 1. Buy a domain on Cloudflare Registrar

Cloudflare Registrar gives you DNS management and tunnel routing in one account. Use it specifically for this project so the API token you create later can be scoped to a single zone.

A `.studio` domain runs around $12/year. Cheaper TLDs work too — anything Cloudflare can host the zone for.

**Verify**: in https://dash.cloudflare.com you can see the zone, with status "Active".

**Common failure**: domain bought elsewhere, then transferred. The DNS doesn't actually move to Cloudflare until you change nameservers at the registrar. If your zone shows "Pending Nameserver Update," fix that before continuing.

## 2. Create a GCP project, link billing, set as gcloud default

```
gcloud projects create <project-id> --name="Personal Infra"
gcloud config set project <project-id>
gcloud beta billing projects link <project-id> --billing-account=<billing-id>
```

Find your billing ID with `gcloud beta billing accounts list`.

**Verify**: `gcloud config get-value project` returns your project ID. `gcloud projects describe <project-id>` shows it active.

**Common failure**: forgetting to link billing. The Compute Engine API will refuse to enable, with a misleading "billing account not found" error.

## 3. Bootstrap the Terraform state bucket

```
./scripts/bootstrap-state-bucket.sh <project-id> us-central1
```

This creates `gs://<project-id>-tfstate` with object versioning. It's idempotent — safe to re-run.

Then write `backend.hcl` in the repo root (gitignored):

```
bucket = "<project-id>-tfstate"
prefix = "personal-infra"
```

**Verify**: `gsutil ls -b gs://<project-id>-tfstate` returns the bucket; `gsutil versioning get gs://<project-id>-tfstate` says enabled.

**Common failure**: bucket name collision (GCS bucket names are globally unique). The script prefixes with your project ID, so collisions are unlikely — but if your project ID is generic, prepend something distinctive.

## 4. Create `terraform.tfvars`

```
cp terraform/terraform.tfvars.example terraform/terraform.tfvars
```

Edit it. Fill in:

- `gcp_project_id` — the project you just made.
- `domain` — e.g. `niranjan.studio`.
- `cloudflare_api_token` — see below.

Leave `cloudflare_tunnel_id` empty for now. We'll fill it after the tunnel is created in step 9.

### Creating the Cloudflare API token

At https://dash.cloudflare.com/profile/api-tokens, **Create Token → Custom Token**:

- **Permissions**:
  - Zone — Zone — Read
  - Zone — DNS — Edit
- **Zone Resources**: Include — Specific zone — `<your domain>`
- **TTL**: leave indefinite, or set a year out.

Cloudflare's reference for token creation is https://developers.cloudflare.com/fundamentals/api/get-started/create-token/. Don't use a Global API Key — far too broad.

**Verify**: `curl https://api.cloudflare.com/client/v4/user/tokens/verify -H "Authorization: Bearer <token>"` returns `"status": "active"`.

**Common failure**: scoping the token to "All zones" or omitting Zone:Read — Terraform's `data "cloudflare_zone"` lookup needs read access on the zone.

## 5. `terraform init`

Terraform's GCS backend authenticates using Application Default Credentials (ADC), which is *separate* from the `gcloud auth login` you already did. ADC is what non-`gcloud` tools — Terraform, the Go cloud client, the Python SDK — read. Without it, `terraform init` fails with `could not find default credentials`.

Set ADC up once per machine:

```
gcloud auth application-default login
```

That opens a browser, authenticates you, and writes `~/.config/gcloud/application_default_credentials.json`. Then:

```
terraform -chdir=terraform init -backend-config=../backend.hcl
```

Pulls the providers (google ~> 6.0, cloudflare ~> 4.0, random ~> 3.0) and configures the GCS backend.

**Verify**: `Terraform has been successfully initialized!` Lockfile `terraform/.terraform.lock.hcl` is created — commit it.

**Common failures**:
- `could not find default credentials` — ADC not set up. Run the `gcloud auth application-default login` command above.
- `403 ... does not have storage.buckets.get` — ADC is set up but for the wrong account. Re-run with the right Google account, or check `gcloud auth application-default print-access-token | head` to see who it's for.
- Backend bucket not found — `backend.hcl` typo, or the bucket wasn't created in step 3.

## 6. First `terraform apply` — GCP only

The `cloudflare_record.vault` resource depends on a tunnel ID that doesn't exist yet. Skip Cloudflare on this pass:

```
terraform -chdir=terraform apply \
  -target=google_compute_instance.obsidian
```

Terraform will warn that `-target` is for exceptional use only — that warning is fine here, this is the documented exceptional case. The first apply creates: APIs, the password secret, the service account, the IAM grant, and the VM.

**Verify**: terraform output prints `ssh_command`, `vm_external_ip`, `couchdb_password_fetch_command`, etc.

**Common failure**: Compute Engine API not enabled in time. Terraform retries automatically — if you see "API not enabled" persisting, wait 60 seconds and re-apply.

## 7. SSH into the VM

```
$(terraform -chdir=terraform output -raw ssh_command)
```

That runs the gcloud SSH command interpolated with your project, zone, and instance name. First connection takes ~20 seconds while OS Login bootstraps your account. Connection-refused right after `terraform apply` returns just means `sshd` hasn't come up yet — wait 60s and retry.

**Verify**: you get a shell prompt on `obsidian-sync`.

**Common failure**: OS Login not enabled at the project or org level. The cloud-init sets `enable-oslogin = TRUE` at the instance level, which is sufficient for personal projects, but if your org has policies blocking SSH altogether, you'll have to relax those.

## 8. Wait for cloud-init to finish, add yourself to the docker group

```
sudo cloud-init status --wait
```

Blocks until `done`. Cloud-init installs Docker, writes the compose file, fetches the CouchDB password from Secret Manager, brings the container up, and runs the LiveSync init script. First boot takes 2–5 minutes.

OS Login creates your account lazily on first SSH, which means cloud-init's "add UID 1000 to docker group" step ran against a non-existent user. Add yourself now:

```
sudo usermod -aG docker "$USER"
newgrp docker      # activate group in current shell, OR exit + SSH back in
```

**Verify**:

```
sudo cloud-init status                                    # status: done
docker ps                                                 # obsidian-couchdb running
sudo ls /var/lib/obsidian/init.done                       # marker file from LiveSync init
sudo bash -c '. /opt/obsidian/.env && \
  curl -sf -u "$COUCHDB_USER:$COUCHDB_PASSWORD" http://localhost:5984/_up'
# expect: {"status":"ok"}
```

`/opt/obsidian/.env` is mode 0600 owned by root by design — only root and the container should ever read it. That's why the curl one-liner runs through `sudo bash -c`.

**Common failures**:
- `cloud-init status` shows `error` — check `sudo cat /var/log/cloud-init-output.log` and the troubleshooting doc. Often a Secret Manager IAM problem or a transient apt mirror.
- `cloud-init: command not found` — image doesn't ship cloud-init. Switch to `ubuntu-os-cloud/ubuntu-2204-lts` (some Debian variants don't include it).
- Cloud-init shows `error` but the curl above returns `{"status":"ok"}` — the system is in the desired state; the error is a historical record. `sudo cloud-init clean --logs` resets it (don't run if you plan to reboot — cloud-init will re-process user-data).

## 9. Run `setup-tunnel.sh` on the VM

The tunnel itself isn't in Terraform — see [tunnel-setup.md](tunnel-setup.md) for the reasoning. `setup-tunnel.sh` sources `scripts/lib/common.sh` via a relative path (`../lib/common.sh`), so copy the whole `scripts/` directory up rather than the two files individually — that preserves the layout.

Pull project and zone from terraform output so you can't typo them:

```
PROJECT=$(terraform -chdir=terraform output -raw gcp_project_id)
ZONE=$(terraform -chdir=terraform output -raw gcp_zone)
INSTANCE=$(terraform -chdir=terraform output -raw instance_name)

gcloud compute scp --recurse scripts \
  "$INSTANCE":~/ \
  --project="$PROJECT" --zone="$ZONE"

gcloud compute ssh "$INSTANCE" --project="$PROJECT" --zone="$ZONE"
# on the VM:
sudo ~/scripts/obsidian/setup-tunnel.sh --domain <your-domain>
```

If the repo is on GitHub and reachable, `git clone` on the VM is the cleanest alternative — no SCP at all, you just `git pull` after future repo changes.

The first run will tell you `cloudflared tunnel login` is required. Run that **NOT** as root — it opens a browser. On a headless VM, `cloudflared tunnel login` prints a URL; open it on your laptop, pick the zone, authorise. The cert lands at `~/.cloudflared/cert.pem` on the VM.

Re-run `sudo ~/scripts/obsidian/setup-tunnel.sh --domain <your-domain>`. It creates the tunnel, writes config, installs the systemd service, and prints the tunnel UUID.

**Verify**: `systemctl status cloudflared` is active. The script prints a tunnel UUID — copy it.

**Common failure**: copy-pasting the URL on a headless VM is awkward. Use `tmux` or resize your terminal so the URL doesn't wrap.

## 10. Put the tunnel ID in `terraform.tfvars`

```
cloudflare_tunnel_id = "<UUID-from-step-9>"
```

## 11. Second `terraform apply` — full

```
terraform -chdir=terraform apply
```

This time Terraform creates the Cloudflare CNAME `vault.<domain>` → `<tunnel-id>.cfargotunnel.com`, proxied.

**Verify**: `terraform output vault_url` returns `https://vault.<domain>`.

**Common failure**: tunnel ID typo. Cloudflare accepts the CNAME (it doesn't validate the target exists), but `curl https://vault.<domain>` will return a 530 error. Fix the ID in tfvars and re-apply.

## 12. Verify end-to-end

```
curl -i https://vault.<domain>/_up
```

Expect `HTTP/2 401` with a `WWW-Authenticate: Basic realm="server"` header. The 401 is *success* — the tunnel reached CouchDB, and CouchDB is asking for credentials. With credentials:

```
curl -u <user>:<password> https://vault.<domain>/_up
# → {"status":"ok"}
```

Get the credentials with:

```
gcloud secrets versions access latest --project=<project> --secret=obsidian-couchdb-password
```

User is `obsidian` (from `obsidian_admin_user` default, or whatever you set).

**Common failure**:
- `530`: tunnel not reaching origin. Check `journalctl -u cloudflared -f` on the VM.
- `502`/`503`: CouchDB container not running. Check `docker ps` on the VM.
- DNS not resolving: Cloudflare DNS propagation usually < 30 seconds; if longer, check the record exists in the dashboard.

## 13. Configure Obsidian clients

Continue with [client-setup.md](client-setup.md). That's where you'll generate the E2EE passphrase — save it to a password manager *before* you turn E2EE on, because there is no recovery.

## After you're done

- The setup state should match: 1 VM running, 1 secret in Secret Manager, 1 IAM binding on it, 1 service account, 1 DNS record in Cloudflare, 1 cloudflared service running on the VM.
- Costs should round to $0/month. Spot-check with `gcloud billing budgets list` or the billing dashboard a week in.
- Snapshot the disk monthly if the vault is important: `gcloud compute disks snapshot obsidian-sync --project=<id> --zone=<zone>`. Snapshots aren't in Terraform — that's deliberate, they're a manual hygiene task.
