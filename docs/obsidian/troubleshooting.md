# Troubleshooting

## `terraform apply` fails on the Cloudflare DNS record

> Error: error finding zone "...": ... or
> Error: invalid CNAME target

You're trying to apply Cloudflare resources before the tunnel exists. The tunnel ID has to come from `cloudflared tunnel create` on the VM, and the variable defaults to empty so the resource is skipped.

Fix: do the first apply with `-target=google_compute_instance.obsidian` to create only the GCP resources. Then SSH in, run `setup-tunnel.sh`, copy the tunnel ID into `terraform.tfvars`, and re-apply without `-target`.

## `terraform apply` fails enabling APIs

> Error: Error when reading or editing Project Service ...: googleapi: Error 403: ... not enabled

Either billing isn't linked to the project (`gcloud beta billing projects link <project-id> --billing-account=<id>`), or your principal lacks `roles/serviceusage.serviceUsageAdmin` on the project. The simplest fix is to ensure you're project Owner.

## LiveSync says "Database not found" on first sync

The init script didn't create the `obsidian` database. SSH into the VM and check:

```
sudo cat /var/log/cloud-init-output.log | grep -A5 init-couchdb
```

If it says "Already initialised, skipping" and there's no `obsidian` DB, the marker was set without the DB being created — usually because the LiveSync init crashed midway. Force a re-run:

```
sudo rm /var/lib/obsidian/init.done
sudo /opt/obsidian/init-couchdb.sh
```

If it says "CouchDB did not respond on /_up": the container isn't healthy. `docker logs obsidian-couchdb` will tell you why. Common cause: leftover data from a prior bad init in `/opt/obsidian/data` blocking startup.

## LiveSync says "CORS error"

CORS is set in the init script's `put_config cors ...` calls. If they didn't run, or were wiped, the symptom is browser-style CORS errors in LiveSync.

```
sudo rm /var/lib/obsidian/init.done
sudo /opt/obsidian/init-couchdb.sh
```

Verify CORS headers are visible:

```
curl -I -X OPTIONS https://vault.<domain>/obsidian \
  -H 'Origin: app://obsidian.md' \
  -H 'Access-Control-Request-Method: GET'
```

You should see `Access-Control-Allow-Credentials: true` and `Access-Control-Allow-Origin: app://obsidian.md`.

## LiveSync says "401 Unauthorized" but credentials are right

Triple-check:

- `obsidian_admin_user` matches what you typed (default `obsidian`, not `admin`).
- The password from Secret Manager has no trailing newline (gcloud sometimes includes one if you used `echo`; use `printf` or just paste from the command output directly).
- The URI has `https://` — LiveSync's "URI" field needs the scheme.

If still failing, hit CouchDB directly from your laptop:

```
curl -u obsidian:<password> https://vault.<domain>/_session
```

Should return your session info. If 401 here too, the password on the VM doesn't match what you think it is. Re-fetch from Secret Manager and look at `/opt/obsidian/.env` on the VM.

## iOS device won't connect

Run through this list in order:

1. **Community plugins enabled on this device?** Settings → Community plugins → on. iOS doesn't sync this from the Mac.
2. **URI exact?** No trailing slash. `https://`, not `http://`. Exact case match on the database name.
3. **Cellular vs wifi?** Some carrier captive portals or restrictive corporate wifi block Cloudflare's edge. Try the other network.
4. **Vault has the plugin enabled?** Open Settings → Community plugins → Installed. Toggle Self-hosted LiveSync if it's off.

If `curl` from a laptop on the same wifi works but iOS doesn't, it's an iOS / app-side issue. Restart Obsidian (force-close from the app switcher) and re-open the LiveSync settings.

## `sudo cloud-init status --wait` says "command not found"

The VM image you're using doesn't ship cloud-init. The bootstrap was silently ignored — none of `/opt/obsidian/`, Docker, or the LiveSync init ran. Confirm with:

```
which cloud-init                   # empty → not installed
sudo ls /opt/obsidian/             # No such file or directory
sudo docker ps                     # docker: command not found
```

Fix: switch to an image that includes cloud-init. Ubuntu LTS cloud images always do; some Debian GCE image variants don't. In `terraform/obsidian.tf`:

```
image = "ubuntu-os-cloud/ubuntu-2204-lts"
```

Then `terraform -chdir=terraform apply -target=google_compute_instance.obsidian`. The image change forces VM replacement, so the new VM boots with cloud-init and processes our `user-data` correctly.

The image type doesn't affect free-tier eligibility — that's only about machine type (`e2-micro`), disk type (`pd-standard`), and network tier (`STANDARD`).

## Cloud-init didn't finish

Status:

```
sudo cloud-init status
```

If `error` or `done` came too fast, check the logs:

```
sudo journalctl -u cloud-init-local -u cloud-init -u cloud-config -u cloud-final --no-pager
sudo cat /var/log/cloud-init-output.log
```

Common issues and fixes:

- **`gcloud: command not found`** — the GCE Debian 12 image is supposed to ship `google-cloud-cli`. If a fresh image dropped it, install manually: `sudo apt-get install -y google-cloud-cli`. Then `sudo cloud-init clean && sudo reboot` to re-run.
- **`Permission denied` on Secret Manager** — the VM service account doesn't have `secretAccessor`. Verify with `gcloud secrets get-iam-policy obsidian-couchdb-password`. Re-apply Terraform if the IAM binding got dropped.
- **Apt mirror failures** — transient. Re-run: `sudo cloud-init clean && sudo reboot`.

## Tunnel isn't reaching the origin (HTTP 530 or 502)

```
sudo systemctl status cloudflared
sudo journalctl -u cloudflared -n 50 --no-pager
```

Common issues:

- `dial tcp 127.0.0.1:5984: connect: connection refused` — CouchDB isn't running. `docker ps`, `docker logs obsidian-couchdb`.
- `error="failed to dial to edge"` — tunnel can't reach Cloudflare. Network issue on the VM. Reboot fixes it most of the time.
- `tunnel credentials file ... not found` — you regenerated the tunnel but didn't update `/etc/cloudflared/config.yml` and `/etc/cloudflared/<id>.json`. Re-run `setup-tunnel.sh`.

## Cost surprise — VM showing up on the bill

First, verify what you're being billed for:

```
# Across all projects on this billing account:
for proj in $(gcloud projects list --format='value(projectId)'); do
  echo "=== $proj ==="
  gcloud compute instances list --project=$proj 2>/dev/null
done
```

Then check the configuration of the Obsidian VM matches free tier:

```
gcloud compute instances describe obsidian-sync \
  --project=<project-id> --zone=<zone> \
  --format='value(machineType.basename(),networkInterfaces[0].accessConfigs[0].networkTier,disks[0].source)'
```

Expect: `e2-micro`, `STANDARD`, and a disk source ending in your instance name. Then check the disk:

```
gcloud compute disks describe obsidian-sync \
  --project=<project-id> --zone=<zone> \
  --format='value(type.basename(),sizeGb)'
```

Expect: `pd-standard`, `30`.

If anything's off (`pd-balanced`, `PREMIUM`, `e2-small`), `terraform plan` will catch it on the next run if the state matches the code. If state has drifted, `terraform apply` will pull it back.

The other free-tier gotcha: free tier covers **one** `e2-micro` per billing account per month, in those three regions. If you have a second `e2-micro` somewhere (test environment, abandoned learning project), you're paying for one of them. Find and delete the duplicate.

## "I want to start over"

Don't `terraform destroy` and re-`apply` unless you're ready to lose the vault. The CouchDB data lives on the VM disk. Destroy includes the disk.

If you want a clean slate:

1. `gcloud compute disks snapshot obsidian-sync --zone=<zone>` first.
2. Then `terraform destroy`.
3. Then `terraform apply` — fresh VM, fresh password, fresh sync.
4. Re-bootstrap Obsidian clients: in LiveSync, "Discard local database and start over", reconfigure, re-upload.

The snapshot lets you recover the raw CouchDB files if you need to forensically extract anything later.
