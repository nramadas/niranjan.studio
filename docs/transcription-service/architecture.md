# Architecture

This is the service-level view of the `transcription-service` and the Phase 4
additions to `obsidian-mcp`. The full system design — diagrams, the trust
model, and the rationale for every decision — lives in
[docs/system/04-phase4-transcription.md](../system/04-phase4-transcription.md).
Read that first; this page is the code map.

## The three layers

Phase 4 is **capture → transcription → vault-write**, deliberately decoupled:

- **Capture** is pluggable. Today it's a Recall.ai meeting bot; a future
  phone audio-capture app is a second capture source that produces the same
  thing — an audio artifact.
- **Transcription** is the isolated spine: `transcription-service` takes an
  audio artifact and returns a diarized transcript through a pluggable backend
  (`TRANSCRIBER=deepgram` now, a local model later). It holds **no** vault
  passphrase and is reachable only by obsidian-mcp over Cloud Run IAM.
- **Vault-write** stays in `obsidian-mcp`, the one component that already holds
  the LiveSync passphrase.

## transcription-service code map

`services/transcription-service/src/`

| Path | What |
|---|---|
| `transcribe/Transcriber/` | the `Transcriber` tag + interface (audio → segments) |
| `transcribe/DeepgramTranscriberLayer/` | Deepgram `/v1/listen` backend (diarize + utterances) |
| `transcribe/parseDeepgramResponse/` | pure mapper: Deepgram JSON → segments (unit-tested) |
| `transcribe/selectTranscriberLayer/` | picks the backend from `TRANSCRIBER`; fails at boot if a Deepgram key is required but missing |
| `http/buildHttpServer/` | `POST /transcribe` (gated by the `X-Transcription-Token` header) + `GET /health` |
| `http/validateBearer/` | constant-time bearer check |
| `config/`, `lib/errors/`, `main.ts` | config tree, `TranscriptionError`, boot |

The backend selection mirrors the vault-indexer's `Embedder`/
`selectEmbedderLayer` pattern exactly.

## obsidian-mcp Phase 4 additions

`services/obsidian-mcp/src/`

| Path | What |
|---|---|
| `meeting/RecallClient{,Layer}/` | Recall.ai client: create / leave / get / getRecording / deleteMedia |
| `meeting/TranscriptionClient{,Layer}/` | client to the transcription-service (Cloud Run ID token + `X-Transcription-Token` bearer) |
| `meeting/handleRecordingReady/` | the webhook payoff: fetch audio → transcribe → `Vault.createNote` → delete media (idempotent) |
| `meeting/verifyRecallSignature/` | Svix signature + timestamp verification |
| `meeting/formatTranscript/` + `extractAudioDownloadUrl/` | pure helpers (markdown formatting, schema-tolerant audio-URL extraction) |
| `mcp/tools/{start,stop,get}MeetingBot/` | the three MCP tools |
| `main.ts` `/recall/webhook` | the unauthenticated, signature-verified webhook route |
| `config/{recallConfig,transcriptionConfig}/` | added to `allConfig` |

## Auth at a glance

- **Claude → obsidian-mcp**: unchanged Phase 2 OAuth.
- **Recall → obsidian-mcp `/recall/webhook`**: Svix signature (no OAuth — Recall
  isn't a Claude client).
- **obsidian-mcp → transcription-service**: Cloud Run IAM (a metadata-server
  ID token in `Authorization`) **plus** an app-layer bearer in
  `X-Transcription-Token` (kept separate because IAM consumes `Authorization`).
- **transcription-service → Deepgram**: `Authorization: Token <key>`.

## Where the transcript ends up

A `meeting-transcript` note under `Meetings/<date> — <title>.md`, written
through the normal E2EE vault path — so it replicates to every device and is
picked up by the Phase 3 indexer like any other note.
