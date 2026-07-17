# Google Meet transcript ingestion — setup

End-state: any Google Meet with transcription enabled — attended from **any of your configured Google accounts** (personal, work, ...) — lands in the vault as `Meetings/<date> — Google Meet <conference-id> <hhmm>.md` (the id + start time keep the path deterministic; the human meeting code goes in the note's `meeting_code` frontmatter), todos extracted from it are merged into `TODO.md`, and per-person facts accumulate in `People/<name>.md`. Design rationale lives in [docs/system/05-phase5-meet-ingestion.md](../system/05-phase5-meet-ingestion.md).

## Prerequisites

- Phases 1–2 deployed (vault + MCP service at `mcp.<domain>`).
- At least one account whose Meet plan includes transcription (transcripts are a Workspace feature, not consumer Gmail). Other accounts you add can still receive transcripts of Workspace meetings they attend.
- Every account must be able to consent to the MCP's OAuth client. If the client is marked *Internal* in GCP Console, only accounts in that Workspace can consent — switch the consent screen to *External* to add a personal `@gmail.com` account; an account in a *different* Workspace additionally needs that org's third-party-app policy to allow it.
- An Anthropic API key if you want the digest (optional — ingestion works without it).

## 1. Apply the Terraform

`terraform/meet-ingestion.tf` enables the Meet / Workspace Events / Pub/Sub APIs and creates:

- topic `meet-events` + publish grant for Google's `meet-api-event-push@system.gserviceaccount.com` (all accounts' subscriptions share this one topic);
- the `meet-push` service account and a push subscription that POSTs to `https://mcp.<domain>/meet/webhook` with an OIDC token (audience = that URL);
- two secrets: `obsidian-mcp-meet-accounts`, `obsidian-mcp-anthropic-api-key`.

```sh
terraform -chdir=terraform apply
```

Leave `meet_ingest_enabled = false` (the default) for this first apply — the service boots with the route disabled until the secrets are real.

## 2. Mint one entry per account

The MCP reads Meet artifacts as *you*, via refresh tokens on the same OAuth client the MCP login flow uses. The `obsidian-mcp-meet-accounts` secret holds a JSON array with one entry per account:

```json
[
  { "name": "personal", "refreshToken": "1//...", "targetResource": "//cloudidentity.googleapis.com/users/111..." },
  { "name": "work",     "refreshToken": "1//...", "targetResource": "//cloudidentity.googleapis.com/users/222..." }
]
```

1. In GCP Console → APIs & Services → Credentials, temporarily add `http://localhost:8123/callback` to the OAuth client's authorized redirect URIs.
2. Run the helper **once per account**, completing the consent screen signed in as that account:

   ```sh
   GOOGLE_OAUTH_CLIENT_ID=... GOOGLE_OAUTH_CLIENT_SECRET=... \
     node scripts/obsidian-mcp/get-google-refresh-token.mjs --name personal
   # then again, in a browser session signed in as the work account:
   GOOGLE_OAUTH_CLIENT_ID=... GOOGLE_OAUTH_CLIENT_SECRET=... \
     node scripts/obsidian-mcp/get-google-refresh-token.mjs --name work
   ```

3. Each run prints a complete `{ name, refreshToken, targetResource }` entry (it derives the target resource from the account's stable Google id) plus the exact `gcloud` commands to store the first entry or append later ones.
4. Remove the localhost redirect URI again if you like.

The requested scope is `meetings.space.readonly` — read-only access to conference records, transcripts, and participants, and the scope that authorizes the transcript event subscription. Revoking an account's token (that account's Google Account → Security → Third-party access) kills ingestion for that account only: the webhook logs a credential error for it and skips to the other accounts. Clean up by removing the dead entry from the secret and redeploying.

## 3. Store the Anthropic key (optional)

```sh
printf '%s' 'sk-ant-...' | gcloud secrets versions add obsidian-mcp-anthropic-api-key --data-file=-
```

Skip this to run ingestion without the digest — the placeholder value disables it cleanly.

## 4. Enable and deploy

In `terraform.tfvars`:

```hcl
meet_ingest_enabled = true
```

```sh
terraform -chdir=terraform apply
scripts/obsidian-mcp/deploy.sh
```

At boot the service logs `meet ingestion enabled for accounts: personal, work` and creates **one Workspace Events subscription per account** itself (watch for `meet subscription created for "personal" (boot)` in the logs), renewing all of them on every delivery thereafter. There is nothing else to schedule. Adding an account later is just: mint its entry (step 2), update the secret, redeploy.

## 5. Verify

1. Start a Meet from each account, turn on transcription (Activities → Transcripts), talk for a minute with a second participant, end the call.
2. Google takes a few minutes to generate the transcript; then:
   - logs show `meet webhook: ingesting conferenceRecords/... as "work"` followed by `wrote Meetings/... (N segments)`;
   - the note appears in Obsidian after a LiveSync pull, with `account: work` and `meeting_code` in its frontmatter;
   - with the digest enabled, `TODO.md` gains any action items and `People/` gains/updates a dossier per participant.

If both accounts were in the same meeting, both subscriptions fire — the second delivery skips as `already-exists`, so you still get exactly one note. Stopping and restarting transcription mid-meeting produces a second transcript resource; its content is appended to the same note as a "Transcript (continued)" section rather than dropped.

## Configuration reference

| Env var | Default | Meaning |
|---|---|---|
| `MEET_INGEST_ENABLED` | `false` | Master switch for the webhook + subscription upkeep. |
| `MEET_PUSH_AUDIENCE` | — | Expected `aud` of the push OIDC token (the webhook URL). |
| `MEET_PUSH_SERVICE_ACCOUNT` | — | Expected email in the push token (`meet-push@...`). |
| `MEET_ACCOUNTS_JSON` | empty | JSON array of `{ name, refreshToken, targetResource }` (Secret Manager). |
| `MEET_PUBSUB_TOPIC` | — | `projects/<p>/topics/meet-events` — shared by all accounts. |
| `MEETING_TRANSCRIPTS_FOLDER` | `Meetings` | Shared with the Recall flow. |
| `ANTHROPIC_API_KEY` | empty | Empty/placeholder = digest disabled. |
| `DIGEST_MODEL` | `claude-opus-4-8` | Model for extract + merge calls. |
| `DIGEST_SELF_NAME` | `Niranjan` | Whose todos to extract; also suppresses a self-dossier. |
| `DIGEST_TODO_NOTE_PATH` | `TODO.md` | The single merged todo list. |
| `DIGEST_PEOPLE_FOLDER` | `People` | Dossier folder. |
| `MEET_TIMEOUT_MS` | `15000` | Per-request timeout for Google API calls. |
| `DIGEST_TIMEOUT_MS` | `300000` | Per-request timeout for Claude digest calls. |

## How events find the right account

A transcript event names only the conference record — not who may read it. The webhook resolves the owning account by trying each configured account's credentials against the conference record: the account matching the delivery's CloudEvents target attribute (when Google includes one) is tried first, then the rest in configured order. A 403/404 means "that account wasn't in the meeting" and moves on; a revoked/invalid refresh token logs a credential error for that account and also moves on. If **no** account can read it, the event is acked and skipped — the log line is `meet webhook: no configured account (…) can read conferenceRecords/…; skipping`, and the webhook's 200 response carries `skipped: "no-account-access"` — since retrying can't fix meeting membership.

## Troubleshooting

- **401 in Pub/Sub delivery logs** — audience mismatch. `MEET_PUSH_AUDIENCE` must byte-match the `audience` on the push subscription (both are `https://mcp.<domain>/meet/webhook` in Terraform).
- **Boot dies with `MEET_INGEST_ENABLED=true but ...`** — the accounts secret is missing, still the placeholder, or malformed JSON. The message names the exact entry/field.
- **`meet subscription upkeep failed for "<name>" ... 403`** — that account's refresh token lacks the Meet scope (re-run the token script signed in as that account; make sure the consent screen listed "view your Google Meet conferences") or the Workspace Events API isn't enabled. Other accounts keep working.
- **`no configured account ... can read` warnings** — a transcript event arrived for a meeting none of the configured accounts can read artifacts for (the event is acked with `skipped: "no-account-access"`). `transcript.v2.fileGenerated` fires for meetings you attend, but artifact *read* access follows Meet's host/owner rules; transcripts of meetings you host always work.
- **No events for one account** — its subscription may have lapsed or its token was revoked; redeploy and watch for `meet subscription created for "<name>" (boot)`. Also confirm the Meet transcript actually generated (Docs file in that account's Drive).
- **Digest never runs** — key is empty or still the `REPLACE_ME` placeholder, or the transcript had zero segments. Look for `meet webhook: digest failed` warnings; ingestion succeeds regardless.
