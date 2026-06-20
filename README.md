# personal-infra

Terraform and supporting scripts for personal cloud infrastructure on GCP. The repo is structured to grow — each project gets its own Terraform file, scripts subdirectory, and docs subdirectory.

## Current projects

- **Obsidian sync** (Phase 1): self-hosted CouchDB on a GCE `e2-micro` VM, exposed via Cloudflare Tunnel, syncing to Obsidian on Mac, iPad, and iPhone via the Self-hosted LiveSync plugin. See [docs/obsidian/setup.md](docs/obsidian/setup.md).
- **Obsidian MCP server** (Phase 2): a Cloud Run service that exposes the same vault to Claude over the Model Context Protocol. Reads and writes encrypted notes through the LiveSync E2EE format. Reached at `mcp.<domain>` via Cloud Run's native domain mapping (no Cloudflare in this path); gated by an OAuth 2.1 server inside the service that uses Google as the OIDC identity provider. See [docs/obsidian-mcp/setup.md](docs/obsidian-mcp/setup.md).
- **Vault indexer** (Phase 3): an always-on container running next to CouchDB on the Phase 1 VM. Subscribes to the CouchDB `_changes` feed, decrypts notes, chunks them by markdown structure, embeds the chunks in-process via `bge-small-en-v1.5`, stores 384-dim vectors in a `sqlite-vec` file, and exposes a private `/search` endpoint that the MCP server calls (over a Cloudflare Access-gated tunnel) as the semantic arm of `search_notes` hybrid retrieval. See [docs/vault-indexer/setup.md](docs/vault-indexer/setup.md).
- **Meeting transcription** (Phase 4): a meeting bot you dispatch from Claude (via new `obsidian-mcp` tools) joins a Zoom/Meet/Teams call and records the audio; a new, isolated `transcription-service` on Cloud Run turns that audio into a diarized transcript via Deepgram (swappable for a local model later); and the MCP writes it into the vault as an ordinary encrypted note. A meeting bot is a call participant, so the audio is necessarily seen in plaintext by the bot + STT vendor — the one place the stack's E2EE can't hold for live data. See [docs/transcription-service/setup.md](docs/transcription-service/setup.md).

## Read this before you spend money

- The free tier requires `e2-micro` in `us-east1` / `us-west1` / `us-central1`, with a `pd-standard` boot disk and `STANDARD` network tier. A typo on disk type or network tier means real charges. The Terraform here pins all three correctly; if you change them, double-check.
- **GCP free tier is per billing account, not per project.** If your billing account already runs an `e2-micro` somewhere, this VM will not be free. Check `gcloud compute instances list --billing-account=<id>` before applying.
- The CouchDB end-to-end-encryption passphrase you'll set during client setup is **unrecoverable**. Save it to a password manager before you turn E2EE on, not after.
- Phase 2 (the MCP server) is going to need that same E2EE passphrase. Encryption at rest is for protecting the bytes on Cloudflare's path, not for hiding notes from Claude — that's the deliberate design.
- Phase 3 (the vault-indexer) **also runs on the e2-micro** alongside CouchDB. 1 GB of RAM is enough but tight; CouchDB ~150 MB, cloudflared ~30 MB, the indexer with ONNX runtime 200–300 MB. Check `free -m` on the VM after deploying Phase 3 to confirm headroom. If memory pressure shows up, the upgrade path is `e2-small` (~$7/mo, no longer free). See [docs/vault-indexer/troubleshooting.md](docs/vault-indexer/troubleshooting.md) § Memory pressure.
- Phase 4 (meeting transcription) adds **no fixed cost** — its `transcription-service` scales to zero — but recording is usage-based: ~$0.88 per recorded hour (Recall.ai capture + Deepgram speech-to-text), billed only when a bot actually runs. It also necessarily sends meeting audio to two third parties (Recall, Deepgram) in plaintext during processing — inherent to a meeting bot. See [docs/system/04-phase4-transcription.md](docs/system/04-phase4-transcription.md) § Trust model.

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
├── package.json                      pnpm workspace root.
├── pnpm-workspace.yaml               Workspace declaration (services/*).
├── .gitignore                        Excludes state, tfvars, env, credentials.
├── .editorconfig                     Baseline editor settings.
├── terraform/
│   ├── main.tf                       Provider config, GCS backend.
│   ├── variables.tf                  Input variables.
│   ├── outputs.tf                    SSH command, IP, secret-fetch command.
│   ├── obsidian.tf                   VM, service account, password secret.
│   ├── obsidian-mcp.tf               Cloud Run MCP service, secrets, IAM, image repo, domain mapping.
│   ├── vault-indexer.tf              Phase 3: secrets, IAM, AR repo, CF Access app + service token, DNS.
│   ├── transcription-service.tf      Phase 4: SA, AR repo, IAM-private Cloud Run, Deepgram + bearer secrets, invoker grant.
│   ├── cloudflare.tf                 DNS records for vault.<domain> (proxied tunnel) and mcp.<domain> (DNS-only to Cloud Run).
│   └── terraform.tfvars.example      Template (real .tfvars is gitignored).
├── services/
│   ├── shared/                       Workspace package: CouchDB client, LiveSync codec, tagged errors, JSON logger.
│   ├── obsidian-mcp/                 TypeScript Cloud Run service (Effect.ts + MCP SDK). Hybrid search + Phase 4 meeting-bot tools + Recall webhook.
│   ├── vault-indexer/                TypeScript on-VM service (Effect.ts + bge-small + sqlite-vec). Phase 3.
│   └── transcription-service/        TypeScript Cloud Run service (Effect.ts + pluggable STT, Deepgram). Phase 4.
├── scripts/
│   ├── bootstrap-state-bucket.sh     One-time: create the GCS state bucket.
│   ├── obsidian/
│   │   ├── cloud-init.yaml           Full VM bootstrap. Phase 3 extends the compose stack.
│   │   └── setup-tunnel.sh           Run-once on the VM: cloudflared setup.
│   ├── obsidian-mcp/
│   │   ├── create-couchdb-user.sh    Provisions the scoped MCP CouchDB user.
│   │   ├── generate-oauth-key.sh     Generates RSA-2048 PKCS#8 and uploads to Secret Manager.
│   │   ├── remove-tunnel-hostname.sh One-time: removes the legacy mcp ingress rule from the VM.
│   │   ├── deploy.sh                 Builds, pushes, and rolls a new Cloud Run revision.
│   │   └── test-local.sh             Runs the server locally against the prod CouchDB.
│   ├── vault-indexer/
│   │   ├── deploy.sh                 Builds, pushes, and ships the indexer to the VM compose stack.
│   │   ├── run-backfill.sh           One-shot backfill of vectors.db from CouchDB.
│   │   ├── add-tunnel-route.sh       Adds indexer.<domain> ingress rule to cloudflared on the VM.
│   │   └── evaluate.sh               Side-by-side embedding-model evaluation harness.
│   ├── transcription-service/
│   │   └── deploy.sh                 Builds, pushes, and rolls the transcription-service Cloud Run revision.
│   └── lib/
│       └── common.sh                 Shared bash helpers.
└── docs/
    ├── runbook.md                    State, secrets, new projects, teardown.
    ├── obsidian/
    │   ├── setup.md                  Phase 1 walkthrough.
    │   ├── tunnel-setup.md           Manual cloudflared steps explained.
    │   ├── client-setup.md           LiveSync on Mac, iPad, iPhone.
    │   └── troubleshooting.md        Common failure modes.
    ├── obsidian-mcp/
    │   ├── setup.md                  Phase 2 walkthrough end to end.
    │   ├── architecture.md           Request flow, trust boundaries.
    │   ├── auth.md                   Auth design and IdP migration recipe.
    │   ├── oauth.md                  OAuth implementation reference.
    │   ├── tools.md                  MCP tool reference.
    │   ├── claude-connection.md      How to add the connector in Claude.
    │   ├── styleguide.md             Code style for both TS services (Phase 2 + Phase 3).
    │   └── troubleshooting.md        Common Phase 2 failure modes.
    ├── vault-indexer/
    │   ├── setup.md                  Phase 3 walkthrough end to end.
    │   ├── architecture.md           Indexing + query paths, trust model for /search.
    │   ├── embedding-model.md        Why bge-small, taintedness model, migration recipe.
    │   ├── indexing-pipeline.md      _changes → debounce → chunk → embed → store.
    │   ├── deployment.md             Image transport, compose dance, rollback.
    │   ├── evaluation.md             Side-by-side model comparison harness.
    │   └── troubleshooting.md        Common Phase 3 failure modes.
    ├── transcription-service/
    │   ├── setup.md                  Phase 4 walkthrough end to end.
    │   ├── architecture.md           The capture/transcription/vault-write split; code map.
    │   ├── deployment.md             Two-service deploy, secrets, webhook model, rollback.
    │   └── troubleshooting.md        Common Phase 4 failure modes.
    └── system/
        ├── 00-overview.md            The whole stack on one page.
        ├── 01-phase1-obsidian-sync.md
        ├── 02-phase2-mcp-server.md
        ├── 03-phase3-vault-indexer.md
        └── 04-phase4-transcription.md
```

When adding a new project: a new `terraform/<project>.tf`, a new `scripts/<project>/`, and a new `docs/<project>/`. The runbook has the checklist.
