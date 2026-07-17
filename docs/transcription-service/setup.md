# Phase 4 setup — meeting transcription

End-to-end walkthrough for standing up the meeting-transcription feature: a
new `transcription-service` on Cloud Run, plus the meeting-bot tools and the
Recall webhook added to your existing Phase 2 `obsidian-mcp` service. After
this you can ask Claude to send a bot to a meeting, and a diarized transcript
lands in your vault under `Meetings/` and becomes searchable.

This assumes Phases 1–3 are already deployed and working. If they aren't,
read [docs/obsidian/setup.md](../obsidian/setup.md),
[docs/obsidian-mcp/setup.md](../obsidian-mcp/setup.md), and
[docs/vault-indexer/setup.md](../vault-indexer/setup.md) first. For the full
design rationale see [docs/system/04-phase4-transcription.md](../system/04-phase4-transcription.md).

## What you're setting up

```
  Claude ──start_meeting_bot (MCP)──► obsidian-mcp (Cloud Run, existing)
                                        │  creates a bot
                                        ▼
                                      Recall.ai bot ──joins──► the meeting
                                        │  (records audio)
            recording-ready webhook ◄──┘
   mcp.<domain>/recall/webhook  │
   (Svix-signature verified)    ▼
        obsidian-mcp ──/transcribe (Cloud Run IAM + bearer)──► transcription-service
                                                                  │ audio
                                                                  ▼
                                                                Deepgram ──transcript──┐
        obsidian-mcp ◄──────────────── diarized transcript ──────────────────────────┘
            │ Vault.createNote (E2EE)
            ▼
        CouchDB  ──► syncs to your devices, indexed by Phase 3
```

Two cloud accounts are involved beyond GCP/Cloudflare: **Recall.ai** (the
meeting bot) and **Deepgram** (speech-to-text). Both see the meeting's audio
in plaintext during processing — this is unavoidable for a meeting bot; see
the trust-model section of the [Phase 4 design doc](../system/04-phase4-transcription.md#trust-model).

## Pre-flight: third-party accounts

1. **Recall.ai** — create an account, note your API key, and note your
   account **region** (`us-east-1`, `us-west-2`, `eu-central-1`,
   `ap-northeast-1`). Recall keys are region-scoped: if yours isn't
   `us-east-1`, set `recall_api_base` in `terraform.tfvars` (e.g.
   `https://us-west-2.recall.ai`) before applying, or every bot call 401s.
2. **Deepgram** — create an account and note an API key. The default model is
   `nova-3`.

You do **not** need the Recall webhook signing secret yet — that comes after
the MCP is deployed (step 5), because the webhook destination URL has to
exist first.

## Sequence

### 1. Apply Terraform

```
terraform -chdir=terraform plan
terraform -chdir=terraform apply
```

What this does:
- Creates the `transcription-service` service account, Artifact Registry repo,
  and an **IAM-private** Cloud Run service (no public invoker; only the
  obsidian-mcp service account is granted `run.invoker`).
- Creates `transcription-deepgram-api-key` (placeholder) and a
  Terraform-generated `transcription-service-bearer`, readable by the right
  service accounts.
- Creates `obsidian-mcp-recall-api-key` and
  `obsidian-mcp-recall-webhook-secret` (placeholders) for the MCP.
- Adds the Phase 4 env vars to the existing `obsidian-mcp` Cloud Run service
  (`TRANSCRIPTION_URL` = the new service's URL, the bearer + Recall secret
  refs, `RECALL_API_BASE`). The MCP image itself doesn't change — its
  `lifecycle.ignore_changes` on `image` is preserved.

**What success looks like:** `terraform output transcription_service_url`
returns the new `*.run.app` URL. (The first apply rolls the obsidian-mcp
service with its *current* image, which ignores the new env — so it keeps
running; the Phase 4 code arrives in step 4.)

### 2. Populate the Deepgram + Recall API keys

The set-commands are printed by `terraform output`:

```
# Deepgram key (the transcription-service reads this)
$(terraform -chdir=terraform output -raw transcription_deepgram_api_key_set_command)

# Recall API key (the MCP reads this)
$(terraform -chdir=terraform output -raw obsidian_mcp_recall_api_key_set_command)
```

Each is a `printf … | gcloud secrets versions add …` — paste your real key in
place of the `<paste …>` placeholder.

### 3. Deploy the transcription-service

```
scripts/transcription-service/deploy.sh --project <your-project>
```

Builds the image (linux/amd64, repo-root context for the workspace shared
package), pushes `service:<git-sha>` to the `transcription-service` AR repo,
and rolls a new Cloud Run revision.

**What success looks like:** the deploy banner prints. The service is
IAM-private, so `/health` isn't curl-able anonymously — verify with an
identity token (you need `run.invoker` on the service):

```
URL=$(gcloud run services describe transcription-service --project=<proj> --region=<region> --format='value(status.url)')
curl -i -H "Authorization: Bearer $(gcloud auth print-identity-token)" "$URL/health"   # → {"ok":true}
```

### 4. Deploy the obsidian-mcp server (Phase 4 code)

```
scripts/obsidian-mcp/deploy.sh --project <your-project>
```

This ships the new meeting-bot tools and the `/recall/webhook` route. The new
config (Recall + transcription) is **required**, so the service won't boot
without the env wired in step 1 — which is why step 1 runs first.

**What success looks like:** Cloud Run logs show `booting obsidian-mcp …` with
no config errors, and the tool list now includes `start_meeting_bot`,
`stop_meeting_bot`, `get_meeting_bot`.

### 5. Configure the Recall webhook

Now that `https://mcp.<domain>/recall/webhook` exists, wire Recall to it:

1. In the Recall dashboard, add a **webhook** with the destination
   `https://mcp.<domain>/recall/webhook` and subscribe to the **`bot.done`**
   event (at minimum).
2. Copy the webhook's **signing secret** (a `whsec_…` value).
3. Store it:
   ```
   $(terraform -chdir=terraform output -raw obsidian_mcp_recall_webhook_secret_set_command)
   ```
4. **Re-run** `scripts/obsidian-mcp/deploy.sh` (or restart the revision).
   Cloud Run resolves `secret:latest` at instance start, so the new secret
   value is only picked up by a fresh revision.

### 6. Verify end-to-end through Claude

Open a Claude conversation with the obsidian-mcp connector attached, start a
real (or test) Zoom/Meet/Teams meeting you host, then:

> Send a transcription bot to this meeting: \<paste the meeting URL\>. Title it "Setup test".

The bot should join as a visible participant named "Niranjan's AI Assistant"
(the `RECALL_BOT_NAME` default), showing the Sutra logo as its camera tile.
End the call. Within a minute or two a note appears at
`Meetings/<today> — Setup test.md` with speaker-labelled turns, and it shows
up in `search_notes`.

To remove a bot mid-call, either kick it from the meeting's participant UI or
ask Claude to `stop_meeting_bot` with the bot id from the dispatch response.

## Confirm the Recall API specifics with that first bot

A few Recall request/response details are written defensively (and are
overridable) because they vary by account/API version. Validate them on the
first real run; if a transcript comes back empty, these are the usual cause:

- The create-bot `recording_config` default is
  `{"audio_mixed_mp3":{},"participant_events":{},"retention":{"type":"timed","hours":2}}`
  (`participant_events` powers the speaker timeline used to put real names on
  diarized turns). If your API version names these keys differently, override it
  without a code change via the `RECALL_RECORDING_CONFIG_JSON` env (set it in
  `terraform/obsidian-mcp.tf` or the secret-free env block).
- The audio download URL is extracted from the bot's `media_shortcuts`
  (preferring `audio_mixed_mp3`, the configured key). If empty transcripts
  persist, inspect a `GET /api/v1/bot/<id>/` response and adjust
  `extractAudioDownloadUrl`.
- The `leave_call` / `delete_media` endpoint paths follow Recall's documented
  v1 API.

## What usually goes wrong

- **Every webhook 401s** — was a header-prefix mismatch (`webhook-*` vs
  `svix-*`); the handler now accepts both. If it still 401s, the
  `obsidian-mcp-recall-webhook-secret` doesn't match the dashboard's signing
  secret, or you didn't redeploy after setting it (step 5.4).
- **Bot calls 401/404** — `recall_api_base` doesn't match your Recall account
  region. Fix the tfvar and `terraform apply`.
- **`/transcribe` returns 403** — the MCP couldn't mint a Cloud Run ID token
  (the obsidian-mcp SA needs `run.invoker` on the transcription-service, which
  Terraform grants) — check the logs for the explicit "could not obtain a
  Cloud Run ID token" message.
- **obsidian-mcp won't boot after step 4** — a Phase 4 secret/env is missing.
  Re-run `terraform apply` and confirm the secrets exist.
- **A transcript is empty** — see the Recall API specifics above.
