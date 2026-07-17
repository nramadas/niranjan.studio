# Phase 5: Google Meet transcript ingestion + digest

Phase 4 put a bot in meetings to capture audio. Phase 5 covers the meetings the bot was never invited to: whenever **Google Meet's own transcription** finishes a transcript — any meeting Niranjan hosted or attended with transcription turned on, from **any of his configured Google accounts** (personal and work both feed the one vault) — the transcript is pulled into the vault automatically, and a Claude-powered digest extracts what matters from it:

- **Todos.** Action items relevant to Niranjan are folded into a single `TODO.md` note — always one merged, deduplicated list, with urgent items at the top.
- **Dossiers.** Each participant gets one note under `People/` accumulating durable facts: concerns they raised, priorities, things they care about.

## What this phase delivers

- Zero-touch ingestion: no bot to dispatch, no MCP tool to call. Turn on transcription in Meet (or have it on by default) and the note appears.
- The transcript lands as an ordinary E2EE vault note under `Meetings/`, exactly like Phase 4 transcripts, so Phase 3 indexes it into hybrid search automatically.
- A digest pipeline (the first LLM call inside the stack itself) that turns each transcript into merged todos and per-person dossier updates.

## The shape of the design: subscribe, push, pull, digest

Google doesn't POST transcripts to you directly. The delivery chain is:

```
Meet finishes generating a transcript
  │  google.workspace.meet.transcript.v2.fileGenerated
  ▼
Google Workspace Events API — ONE subscription PER ACCOUNT
  │  (target: that account's user — fires for meetings it hosts *or* attends)
  ▼
Pub/Sub topic `meet-events`  (terraform/meet-ingestion.tf — shared by all accounts)
  │  push subscription, OIDC-token-authenticated
  ▼
obsidian-mcp  POST /meet/webhook
  │  1. verify the push token (audience + meet-push service account)
  │  2. resolve which account can read the conference (hint first, then probe)
  │  3. Meet REST API: conference record, transcript entries, participants
  │  4. format + write the E2EE transcript note (Meetings/…, `account:` frontmatter)
  │  5. digest with Claude → merge TODO.md, update People/<name>.md
  ▼
CouchDB (encrypted) ──▶ LiveSync clients + Phase 3 indexer
```

Two properties fall out of this shape:

- **The event carries only a resource name**, never transcript content — content crosses the wire exactly once, over the authenticated Meet REST API pull, and goes straight into the E2EE write path.
- **The webhook is idempotent, transcript-aware, and built only from stable inputs.** The note path derives from the conference-record id + start time — never the human meeting code, whose lookup is fallible and can differ per account (it lands in `meeting_code` frontmatter instead). The note's `transcripts` frontmatter lists every transcript folded in: a redelivery of a known transcript skips; a *new* transcript of the same conference (transcription stopped and restarted) is appended as a continuation section rather than dropped. This also dedupes the multi-account case: when two configured accounts attend the same meeting, both subscriptions fire, and the second delivery resolves to the same path and skips. A concurrent-create race (two Cloud Run instances) fails the loser so Pub/Sub retries it into the skip path — the digest only ever runs after a successful write.

## Multiple accounts

Accounts live in one Secret Manager JSON array (`obsidian-mcp-meet-accounts`): `{ name, refreshToken, targetResource }` per account, validated at boot by `parseMeetAccounts`. Everything downstream is keyed by account name — per-account bearer caches in `MeetClientLayer`, one Workspace Events subscription per account, `account:` in the note frontmatter.

The only genuinely new logic is **event→account routing**: a transcript event names the conference record but not who may read it (Meet artifact ACLs follow meeting membership). The handler tries the account matching the delivery's CloudEvents target attribute first (when Google includes one), then probes the rest in configured order; 403/404 means "not a member, next", a revoked/invalid refresh token logs a credential error and also moves to the next account (one dead account must never block the other's ingestion), any other error fails the webhook so Pub/Sub retries, and if no account has access the event is acked and skipped — membership won't change on retry.

## Components

| Piece | Where | Job |
|---|---|---|
| `parseMeetAccounts` | `services/obsidian-mcp/src/meeting/` | Boot-time validation of the accounts secret into `{ name, refreshToken, targetResource }` entries (tokens wrapped in Redacted at the boundary). |
| `MeetClient` / `MeetClientLayer` | `services/obsidian-mcp/src/meeting/` | Meet REST API + Workspace Events API client, account-scoped: per-account bearers minted from each refresh token; reads conference records, transcript entries, participants; creates/renews one event subscription per account. |
| `verifyMeetPushToken` | same | Verifies the OIDC token Pub/Sub attaches to each push (Google JWKS, audience, service-account email). |
| `parseMeetPushMessage` | same | Decodes the Pub/Sub envelope + CloudEvents attributes into a typed message. |
| `buildMeetSegments` | same | Meet entries → the diarized-segment shape `formatTranscript` already consumes. Meet attributes speakers directly, so no overlap alignment is needed — participant resource → stable speaker index → display name. |
| `handleMeetTranscript` | same | The orchestration: idempotency check → pull → format → vault write → digest. |
| `DigestClient` / `DigestClientLayer` | `services/obsidian-mcp/src/digest/` | Claude (official SDK, structured outputs) extracts todos + person facts, and performs the TODO-list merge. |
| `applyDigest`, `mergeDossier` | same | Write the digest into the vault. Dossier merges are deterministic (dated bullets, dedupe); the TODO merge is an LLM call because "one list, deduplicated, urgent first" is a semantic merge. |
| Pub/Sub plumbing | `terraform/meet-ingestion.tf` | Topic, Google's publisher grant, push subscription with OIDC identity, the two new secrets. |

## Who owns the Workspace Events subscriptions

Deliberately **not Terraform**. A Meet event subscription must be created with the *user's* OAuth credentials (a service account can't subscribe to someone else's meetings), and it expires on a Google-controlled TTL. Since the service already holds those credentials (the per-account refresh tokens), it owns the whole lifecycle, per account:

- **At boot** it creates each account's subscription if missing, reactivates it if suspended, renews it otherwise. A fresh deploy on an empty project self-heals into a working pipeline; adding an account to the secret + redeploying is all it takes to subscribe it.
- **On every verified push** it opportunistically renews every account's subscription in the background (one account's failure never blocks the others). Google also delivers `expirationReminder` lifecycle events to the same topic, which arrive as pushes and trigger the same renewal.

The one gap: if no event of any kind arrives for the entire subscription TTL (Google's maximum for Meet events), a subscription can lapse; the next boot (any deploy, or any cold start) recreates it. If that gap ever matters in practice, a weekly Cloud Scheduler ping to any endpoint would close it.

## The digest

`digestTranscript` sends the formatted transcript to Claude (`claude-opus-4-8`, structured outputs, adaptive thinking) and gets back a schema-validated object:

- `todos[]` — items Niranjan owns: his commitments, work assigned to him, follow-ups he promised, things he must chase. Each has an `urgent` flag grounded in the conversation (explicit deadline, "ASAP", blocking someone).
- `people[]` — per-participant durable facts (concerns, priorities, preferences), excluding Niranjan himself, with an instruction to never invent.

Then two different merge strategies, chosen by what each merge actually requires:

- **`TODO.md`** — a second LLM call receives the note's current body plus the new todos and returns the complete new body: one checklist, urgent items on top, existing items (including checked `- [x]` ones and hand-edits) preserved, semantic duplicates collapsed. Deterministic code can't decide that "send Alice the deck" and "share slides with Alice" are one item; the model can.
- **`People/<name>.md`** — deterministic (`mergeDossier`): facts are appended as `- fact — date, meeting` bullets under `## Concerns & interests`, deduplicated case/punctuation-insensitively. No LLM, no cost, no risk to hand-written notes.

Digestion is **best-effort by design**: it runs only after the transcript note is safely written, and any failure (API down, key missing, refusal) is logged, not surfaced — a 500 would make Pub/Sub redeliver an event whose note already exists, which would skip out before ever digesting. Leaving `ANTHROPIC_API_KEY` unset disables digestion cleanly while ingestion keeps working.

## Trust model

- **Transcript text is produced by Google** — it exists in Google's systems regardless (that's where Meet transcription runs). This phase reads it over OAuth and writes it into the same E2EE path as every other note; Pub/Sub only ever sees resource names.
- **The digest sends transcript text to Anthropic.** That's a new third party seeing meeting content, on top of Google. Same reasoning as Phase 4's STT trade: the content is already plaintext-visible to one processor; digestion is opt-in via the API key and scoped to exactly the transcript body.
- **The webhook is internet-reachable but triple-checked**: Google-signed OIDC token (signature via Google's JWKS), audience must equal the webhook URL, and the token's service-account email must be the dedicated no-role `meet-push` SA.
- **The refresh tokens are the crown jewels of this phase** (read access to each account's meeting artifacts). They live together in one Secret Manager secret, readable only by the MCP service account, and each is independently revocable from that account's Google security settings — revoking one account leaves the others running.

## Cost

- Pub/Sub at this volume is effectively free; Meet transcription is included in Workspace.
- The digest is the only metered piece: roughly one Claude call per meeting plus one per batch of todos — pennies per meeting at Opus pricing, zero when no meetings happen or the key is unset.

## How Phase 5 composes with the rest of the system

Phase 5 is the second producer for the pipeline Phase 4 built: both end at the same `formatTranscript` → `vault.createNote` seam, produce notes in the same folder with the same frontmatter shape (`source: google-meet` vs `source: recall`), and get indexed by Phase 3 the moment CouchDB's `_changes` feed ticks. The digest module is source-agnostic — it takes a formatted transcript, so pointing it at Recall-bot transcripts later is a two-line change in `handleRecordingReady`.
