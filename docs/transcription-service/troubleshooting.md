# Troubleshooting

Symptom-first guide for the Phase 4 meeting-transcription feature. Logs are
the first stop:

```
gcloud run services logs tail obsidian-mcp           --project=<id> --region=<region>
gcloud run services logs tail transcription-service  --project=<id> --region=<region>
```

## A bot never joins the meeting

- **`start_meeting_bot` returns a RecallError 401/404.** The Recall API key or
  region host is wrong. `RECALL_API_BASE` must match your Recall account's
  region (set `recall_api_base` in tfvars and re-apply). Confirm the key with
  `gcloud secrets versions access latest --secret=obsidian-mcp-recall-api-key`.
- **The tool succeeds but no bot appears.** Check the meeting URL is a
  supported platform (Zoom / Google Meet / Teams) and the link is joinable
  (not a waiting-room-only host setting that rejects unknown participants).

## No transcript note is created after the meeting

Work down the pipeline in the MCP logs:

- **No `recall webhook` log line at all.** Recall isn't delivering. In the
  Recall dashboard, confirm a webhook exists pointing at
  `https://mcp.<domain>/recall/webhook`, subscribed to `bot.done`, and check
  its recent-deliveries view for errors.
- **`recall webhook: signature verification failed` (401).** The
  `obsidian-mcp-recall-webhook-secret` doesn't match the dashboard's signing
  secret, or you set the secret but didn't redeploy obsidian-mcp afterwards
  (Cloud Run reads `secret:latest` only at instance start). Re-set and
  redeploy. (Both `webhook-*` and `svix-*` header prefixes are accepted, and a
  stale timestamp >5 min is rejected as replay — an out-of-sync clock can
  cause that.)
- **`bot … produced no recording; nothing to transcribe`.** Expected for a
  meeting where the bot was denied recording, kicked, never admitted, or the
  call was empty. Not an error — there was nothing to transcribe.
- **`transcript already exists … skipping`.** A duplicate/retry delivery; the
  note from the first delivery is already in the vault. Working as intended.

## The note is created but the transcript is empty

Almost always the Recall `recording_config` or media-URL shape:

- The default requests `audio_mixed_mp3`. If your Recall API version names the
  mixed-audio request key differently, the bot records nothing and
  `getRecording` finds no audio URL. Override `RECALL_RECORDING_CONFIG_JSON`
  (no code change needed) and confirm against a `GET /api/v1/bot/<id>/`
  response.
- If audio *is* recorded but `extractAudioDownloadUrl` can't find the URL,
  inspect the bot's `media_shortcuts` in that response and adjust the
  extractor's preferred keys.

## `/transcribe` returns 403

The transcription-service is IAM-private. The MCP must present a Google-signed
ID token. A `could not obtain a Cloud Run ID token` log line means the
metadata fetch failed — verify the obsidian-mcp service account has
`run.invoker` on the transcription-service (Terraform grants this) and that
`TRANSCRIPTION_USE_ID_TOKEN=true` in production.

## `/transcribe` returns 401

The app-layer bearer mismatched. The MCP sends `transcription-service-bearer`
in the `X-Transcription-Token` header; the service checks it against
`AUTH_BEARER_TOKEN`. Both come from the same Secret Manager secret — if you
rotated it, redeploy **both** services.

## Deepgram errors (5xx / "returned 4xx")

- A 401 from Deepgram → the `transcription-deepgram-api-key` is unset/wrong.
- A 400 → usually an unreachable/expired audio URL (Recall download URLs are
  short-lived; the synchronous flow fetches promptly, but a very delayed
  retry could find it expired — the idempotency pre-check normally short-
  circuits those first).

## obsidian-mcp won't boot

The Phase 4 config is required. A boot-time config error names the missing
var. Re-run `terraform apply` so the secrets + env exist, then redeploy.
(During a fresh rollout, deploy the transcription-service before obsidian-mcp:
the MCP's `TRANSCRIPTION_URL` points at it.)

## Duplicate Deepgram charges on a long meeting

A known, bounded residual: if Svix retries a slow delivery onto a second
Cloud Run instance mid-transcription, Deepgram is billed twice (the note stays
single — idempotent). Rare at personal volume. If it becomes a real cost,
the upgrade path is an ack-fast + Cloud Tasks processing queue (see
[deployment.md](deployment.md) § Webhook processing model).
