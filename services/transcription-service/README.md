# transcription-service

The isolated speech-to-text spine for Phase 4 (meeting transcription). It
takes an audio artifact and returns a diarized transcript. It is a small
Cloud Run service that scales to zero, holds **no** vault passphrase, and
is reachable only by `obsidian-mcp` over Cloud Run IAM.

See [`docs/system/04-phase4-transcription.md`](../../docs/system/04-phase4-transcription.md)
for where this fits in the stack, and
[`docs/transcription-service/`](../../docs/transcription-service) for the
service-level docs.

## HTTP surface

- `GET /health` — unauthenticated liveness probe. `{ ok: true }`.
- `POST /transcribe` — bearer-gated. Body:
  ```
  { "audioUrl"?: string, "audioBase64"?: string, "mimeType"?: string, "diarize"?: boolean }
  ```
  Exactly one of `audioUrl` / `audioBase64` is required. Returns:
  ```
  { "segments": [{ "speaker": number, "start": number, "end": number, "text": string }],
    "language"?: string, "modelName": string }
  ```

## Backends

The backend is chosen at boot from the `TRANSCRIBER` env var, behind the
`Transcriber` tag — the same pattern as the vault-indexer's `Embedder`:

- `deepgram` (default) — Deepgram pre-recorded API (`nova-3`, diarized).
- `local` (future) — an on-VM model; selecting it today fails fast at boot.

A new backend implements `TranscriberImpl`, adds a case to
`selectTranscriberLayer`, and changes nothing else — not the HTTP surface,
not the caller, not the vault.

## Local development

```
cp .env.example .env.local   # fill in DEEPGRAM_API_KEY + AUTH_BEARER_TOKEN
pnpm --filter transcription-service dev
```

`pnpm --filter transcription-service test` runs the unit tests (the pure
Deepgram-response mapper and the bearer check; the network call is mocked).
