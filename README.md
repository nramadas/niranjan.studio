# personal-infra

Terraform and supporting scripts for personal cloud infrastructure on GCP. The repo is structured to grow — each project gets its own Terraform file, scripts subdirectory, and docs subdirectory.

## Current projects

- **Obsidian sync** (Phase 1): self-hosted CouchDB on a GCE `e2-micro` VM, exposed via Cloudflare Tunnel, syncing to Obsidian on Mac, iPad, and iPhone via the Self-hosted LiveSync plugin. See [docs/obsidian/setup.md](docs/obsidian/setup.md).
- **Obsidian MCP server** (Phase 2): a Cloud Run service that exposes the same vault to Claude over the Model Context Protocol. Reads and writes encrypted notes through the LiveSync E2EE format, fronted by the same Cloudflare Tunnel under a second hostname, gated by Cloudflare Access plus a server-side bearer token. See [docs/obsidian-mcp/setup.md](docs/obsidian-mcp/setup.md).

## Read this before you spend money

- The free tier requires `e2-micro` in `us-east1` / `us-west1` / `us-central1`, with a `pd-standard` boot disk and `STANDARD` network tier. A typo on disk type or network tier means real charges. The Terraform here pins all three correctly; if you change them, double-check.
- **GCP free tier is per billing account, not per project.** If your billing account already runs an `e2-micro` somewhere, this VM will not be free. Check `gcloud compute instances list --billing-account=<id>` before applying.
- The CouchDB end-to-end-encryption passphrase you'll set during client setup is **unrecoverable**. Save it to a password manager before you turn E2EE on, not after.
- Phase 2 (the MCP server) is going to need that same E2EE passphrase. Encryption at rest is for protecting the bytes on Cloudflare's path, not for hiding notes from Claude — that's the deliberate design.

## Prerequisites

- `gcloud` CLI, authenticated (`gcloud auth login`) and pointed at a GCP project with billing enabled.
- Application Default Credentials set up: `gcloud auth application-default login`. ADC is what Terraform reads — it's separate from `gcloud auth login` and easy to forget. Without it, `terraform init` fails on the GCS backend with `could not find default credentials`.
- Terraform >= 1.6.
- `cloudflared` (only on the VM — installed by the bootstrap script).
- A Cloudflare account with a domain registered through Cloudflare Registrar.

## Quickstart

Follow [docs/obsidian/setup.md](docs/obsidian/setup.md) end to end. The TL;DR is:

1. `scripts/bootstrap-state-bucket.sh <project-id> <region>`
2. `cp terraform/terraform.tfvars.example terraform/terraform.tfvars` and fill it in.
3. `terraform -chdir=terraform init -backend-config=../backend.hcl`
4. `terraform -chdir=terraform apply -target=google_compute_instance.obsidian` (first pass — Cloudflare DNS depends on the manually-created tunnel ID).
5. SSH in, run `scripts/obsidian/setup-tunnel.sh`, copy the tunnel ID into `terraform.tfvars`.
6. `terraform -chdir=terraform apply` (second pass — DNS record gets created).
7. Configure Obsidian LiveSync per [docs/obsidian/client-setup.md](docs/obsidian/client-setup.md).

Operational reference (state recovery, secrets, adding new projects, teardown) lives in [docs/runbook.md](docs/runbook.md).

## Repo structure

```
personal-infra/
├── README.md                         You are here.
├── .gitignore                        Excludes state, tfvars, env, credentials.
├── .editorconfig                     Baseline editor settings.
├── terraform/
│   ├── main.tf                       Provider config, GCS backend.
│   ├── variables.tf                  Input variables.
│   ├── outputs.tf                    SSH command, IP, secret-fetch command.
│   ├── obsidian.tf                   VM, service account, password secret.
│   ├── obsidian-mcp.tf               Cloud Run MCP service, secrets, IAM, image repo.
│   ├── cloudflare.tf                 DNS records for vault.<domain> and mcp.<domain>.
│   └── terraform.tfvars.example      Template (real .tfvars is gitignored).
├── services/
│   └── obsidian-mcp/                 TypeScript Cloud Run service (Effect.ts + MCP SDK).
├── scripts/
│   ├── bootstrap-state-bucket.sh     One-time: create the GCS state bucket.
│   ├── obsidian/
│   │   ├── cloud-init.yaml           Full VM bootstrap.
│   │   └── setup-tunnel.sh           Run-once on the VM: cloudflared setup.
│   ├── obsidian-mcp/
│   │   ├── create-couchdb-user.sh    Provisions the scoped MCP CouchDB user.
│   │   ├── add-tunnel-hostname.sh    Adds the second tunnel ingress to the VM.
│   │   ├── deploy.sh                 Builds, pushes, and rolls a new Cloud Run revision.
│   │   └── test-local.sh             Runs the server locally against the prod CouchDB.
│   └── lib/
│       └── common.sh                 Shared bash helpers.
└── docs/
    ├── runbook.md                    State, secrets, new projects, teardown.
    ├── obsidian/
    │   ├── setup.md                  Phase 1 walkthrough.
    │   ├── tunnel-setup.md           Manual cloudflared steps explained.
    │   ├── client-setup.md           LiveSync on Mac, iPad, iPhone.
    │   └── troubleshooting.md        Common failure modes.
    └── obsidian-mcp/
        ├── setup.md                  Phase 2 walkthrough end to end.
        ├── architecture.md           Request flow, trust boundaries.
        ├── auth.md                   Auth design and migration recipe.
        ├── access-setup.md           Cloudflare Access policy walkthrough.
        ├── tools.md                  MCP tool reference.
        ├── claude-connection.md      How to add the connector in Claude.
        └── troubleshooting.md        Common Phase 2 failure modes.
```

When adding a new project: a new `terraform/<project>.tf`, a new `scripts/<project>/`, and a new `docs/<project>/`. The runbook has the checklist.
