# Deployment

Reference for the Phase 4 deploy flow: how the two services are built and
rolled, how the obsidian-mcp env is wired, how secrets rotate, how the
webhook is processed, where logs live, and how to roll back. For the
first-time, step-by-step walkthrough see [setup.md](setup.md).

## Two moving parts

Phase 4 touches two Cloud Run services:

- **`transcription-service`** — new, IAM-private, its own AR repo
  (`transcription-service`) and service account. Deployed by
  `scripts/transcription-service/deploy.sh`.
- **`obsidian-mcp`** — the existing Phase 2 service, now also hosting the
  meeting-bot tools and the `/recall/webhook` route. Deployed by the existing
  `scripts/obsidian-mcp/deploy.sh` (unchanged).

Both build with the **repository root** as the Docker context (so the
`@niranjan/vault-shared` workspace package is reachable); each `deploy.sh`
passes `-f services/<svc>/Dockerfile <repo-root>`.

Deploy order on a fresh Phase 4 rollout: `terraform apply` →
`transcription-service` → `obsidian-mcp`. The obsidian-mcp env references the
transcription-service URL, so the service must exist (Terraform creates it)
before the MCP boots with the Phase 4 image.

## What each deploy.sh does

Both follow the Phase 2 Cloud Run pattern: resolve `--project` (flag or
`terraform output`), build linux/amd64, push `<name>:<git-sha>` + `:latest`
to Artifact Registry, then `gcloud run services update --image=…`. Terraform's
`lifecycle.ignore_changes` on the image lets the script own the image while
Terraform owns everything else.

The transcription-service `/health` is **not** publicly reachable (IAM-private),
so its deploy banner shows an identity-token curl rather than an anonymous one.

## Env + secrets (Terraform-owned, not deploy.sh)

Unlike the on-VM vault-indexer (whose `.env` is written by its deploy script),
both Cloud Run services get their env from Terraform — plain values inline,
secrets via `value_source.secret_key_ref`. The Phase 4 secrets:

| Secret | Read by | Populated |
|---|---|---|
| `transcription-deepgram-api-key` | transcription-service SA | out-of-band (`terraform output … _set_command`) |
| `transcription-service-bearer` | both SAs | Terraform-generated |
| `obsidian-mcp-recall-api-key` | obsidian-mcp SA | out-of-band |
| `obsidian-mcp-recall-webhook-secret` | obsidian-mcp SA | out-of-band (from the Recall dashboard) |

**Rotation:** write a new version (`gcloud secrets versions add …`) then
**redeploy** the owning service. Cloud Run resolves `secret:latest` at
instance start, so a running revision keeps the old value until it's rolled.

## Webhook processing model

The `/recall/webhook` route verifies the Svix signature (accepting both
`webhook-*` and `svix-*` header prefixes, with a ±5-minute timestamp window),
then processes the recording **synchronously** within the request:
fetch audio → `/transcribe` → `Vault.createNote` → delete the Recall media.
Synchronous keeps Cloud Run CPU allocated for the duration (reliable on
scale-to-zero, unlike fire-and-forget after the response).

Recall/Svix time out a delivery at ~15 s and retry, so a long meeting's first
delivery is marked failed and retried. This is handled, not harmful:

- An in-flight `Set` returns a fast 200 on a concurrent same-instance retry,
  so Svix stops retrying while the original keeps processing.
- A durable note-existence pre-check (on the deterministic
  `Meetings/<date> — <title>.md` path, with a bot-id suffix for untitled
  meetings) makes post-completion and post-media-delete retries idempotent.
- `createNote` conflicts are caught and treated as already-processed.
- A `bot.done` with no recording (denied/kicked/empty call) is a clean
  success skip, not a 500 — so Svix never enters a retry storm.

**Known residual:** if a retry races onto a *second* instance while the first
is mid-transcription, Deepgram is billed twice (the note stays idempotent).
Rare at personal volume. The fully-robust fix — ack-fast + a Cloud Tasks queue
that drives a separate processing endpoint — is a deliberate future
enhancement, not needed for v1.

## Logs

Both services log JSON lines (the shared `cloudRunLogger`):

```
gcloud run services logs tail transcription-service --project=<id> --region=<region>
gcloud run services logs tail obsidian-mcp           --project=<id> --region=<region>
```

Useful filters in the MCP logs: `recall webhook` (webhook lifecycle),
`no recording` (skipped bots), `deleteMedia failed` (Recall cleanup issues).

## Rollback

Roll either service back to a prior image tag (Artifact Registry keeps tags):

```
gcloud run services update transcription-service --project=<proj> --region=<region> \
  --image=<region>-docker.pkg.dev/<proj>/transcription-service/service:<prev-sha>
gcloud run services update obsidian-mcp --project=<proj> --region=<region> \
  --image=<region>-docker.pkg.dev/<proj>/obsidian-mcp/server:<prev-sha>
```

Rolling obsidian-mcp back to a **pre-Phase-4** image is safe — it simply
ignores the new env and the `/recall/webhook` route disappears (Recall
deliveries will then fail and retry until you roll forward again or disable
the webhook in Recall).

## What's NOT here

- **No CI/CD.** Deploys are local-laptop affairs, same as the other services.
- **No calendar auto-join.** Bots are dispatched only by an explicit MCP
  tool call in v1; hands-free calendar auto-join is "Phase 4.5" (see the
  composes-with section of [the design doc](../system/04-phase4-transcription.md)).
- **No local STT yet.** `TRANSCRIBER=deepgram` is the only implemented
  backend; `TRANSCRIBER=local` is reserved and fails fast at boot.
