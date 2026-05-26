# Indexing pipeline

Operational detail of how a note edit on a phone in Obsidian propagates through to a fresh row in `vault_chunks` on the VM. Read after [architecture.md](architecture.md), before [troubleshooting.md](troubleshooting.md).

## End-to-end

1. **Obsidian client writes locally.** LiveSync detects the file change.
2. **LiveSync syncs to CouchDB.** The note doc plus any new chunk docs land in the database. Old chunks are still there (LiveSync is append-only — chunk docs are content-addressed via their HKDF hash).
3. **CouchDB emits a `_changes` event** on the continuous feed the indexer is subscribed to. The event carries `{ id, seq, deleted? }` with `includeDocs: false`.
4. **`processChangeEvent` classifies.** Chunk docs (`h:` / `h:+` prefix), system docs (`_local/`, `_design/`), LiveSync internal docs (`i:`) are skipped. Deleted note docs log a warning and are otherwise ignored (see § Orphan cleanup). Live note docs become a `reindex` action.
5. **`ChangesQueue.enqueueReindex`** stores `{ docId → lastSeenMs }` in a `Ref<Map>`. Existing entries for the same docId have their `lastSeenMs` overwritten — successive edits collapse.
6. **A daemon fiber wakes every `CHANGES_DEBOUNCE_MS / 4` ms** and pulls out entries older than `CHANGES_DEBOUNCE_MS`. For each, it calls `reindexNoteById(docId, chunkingParams)`.
7. **`reindexNoteById` resolves the doc id to a `NoteRead`** via the shared `Vault.readNoteById`. That call: `CouchClient.getDoc` → decrypt `path` (if obfuscated) → fetch chunks → decrypt chunks → reassemble body → parse frontmatter.
8. **`reindexFromNote` chunks the body** via the markdown chunker (header-aware, paragraph-packed, with overlap), producing a list of `NoteChunk { hash, index, text, charStart, charEnd }`.
9. **`store.listChunkHashesByPath`** returns the existing `{ hash, rowid }` pairs for this note. The diff is implicit: chunks whose hash is present already → skip. Chunks whose hash is new → embed.
10. **`embedder.embed(newChunkTexts)`** produces unit-length 384-dim vectors. The bge-small path runs ONNX in-process; the OpenAI path POSTs to the API.
11. **`store.upsertChunks(path, rev, allIncomingChunks)`** runs the SQLite transaction:
    - For each incoming chunk whose hash is not in the prior set: `INSERT` (with embedding, text, etc.).
    - For each prior row whose hash is not in the incoming set: `DELETE` (by `rowid`).
    - Inserts run *before* deletes — concurrent KNN reads see either the old full set or the new full set, never a gap.
12. **One log line per processed doc:**
    ```
    [info] reindexed notes/foo.md: +2 -1 =5
    ```
    means 2 new chunks embedded, 1 stale chunk removed, 5 unchanged. The diff numbers tell you whether the indexer is doing the right amount of work — a `+200 -200 =0` line on a one-paragraph edit means the chunker isn't stable across whitespace, which is a bug.

## Why content-addressed diffing

A 5,000-token note with 13 chunks gets a one-paragraph edit. Without content-addressed diffing, you'd re-embed all 13 chunks every save, even though 12 of them are byte-identical to the pre-edit version. That's 12× the inference work for zero quality benefit, and on the e2-micro the difference is meaningful.

With content-addressed diffing (`sha256(chunkText)` truncated to 16 hex chars), the chunker emits the same hash for byte-identical chunks across edits, and the store's diff treats them as "already present." A typical paragraph edit re-embeds 1–2 chunks (the edited one and possibly its overlap neighbour).

**Stability requirement:** the chunker must be deterministic. Given the same body, it must emit the same chunk sequence with the same hashes. The chunker today is deterministic up to and including the overlap window, but if you change `CHUNK_TOKEN_TARGET`, `CHUNK_TOKEN_OVERLAP`, or `CHUNK_TOKEN_MIN`, every note's chunks change and the next reindex is effectively a full re-embed for that note. That's expected behaviour; just be aware.

## Tunable parameters

All three are tunable via env vars on the indexer container. Defaults reflect what the original spec asked for.

| env var | default | what it does |
|---|---|---|
| `CHUNK_TOKEN_TARGET` | 384 | Target chunk size in estimated tokens. Higher → fewer, longer chunks (better global context, worse precision). Lower → many short chunks (better precision, more storage, more embedding work). |
| `CHUNK_TOKEN_OVERLAP` | 50 | Tokens of tail-of-prev-chunk carried into the next chunk. Higher → queries that straddle a chunk boundary recall both chunks more reliably, at the cost of more total content embedded. |
| `CHUNK_TOKEN_MIN` | 64 | Chunks smaller than this are merged into their neighbour. Without this, a note ending in "TODO" emits a one-line chunk that dominates KNN results for unrelated queries. |
| `CHANGES_DEBOUNCE_MS` | 2000 | How long the queue waits after the most recent change for a given doc before reindexing. Higher → fewer redundant embeds during burst saves; lower → fresher results after a single edit. Sub-second is overkill for personal use; multi-second is noticeable. |

If you change `CHUNK_TOKEN_*`, expect the next reindex of every note to fully re-embed.

## Orphan cleanup

The changes-feed pipeline does **not** clean up chunks for notes that have been deleted from the vault. Reason: LiveSync's `deleteNote` semantics are a rename to `.trash/<original>` plus a tombstone on the original doc id, and the tombstone arrives via the `_changes` feed as `{ id, deleted: true }`. To honor that, the indexer would need to know what *path* the original doc id was associated with — which it doesn't, because the change event with `includeDocs: false` doesn't carry the doc body. We could resolve via the SQLite store (it knows `note_path`), but a v1-simple alternative is:

- The trash copy is a fresh note at a new path. The changes feed sees it as a normal create — chunks get indexed for `.trash/<path>`. That's fine; the .trash folder is part of the vault.
- The original path's chunks become orphans. They no longer match queries strongly, because their content is now in `.trash/`.
- **The backfill cleans them up.** `scripts/vault-indexer/run-backfill.sh` reads `Vault.readAllForIndex` (which excludes tombstoned docs) and reindexes — orphans aren't matched, and the backfill's orphan-cleanup pass would drop them. (TODO: the orphan-cleanup pass is documented but not yet wired in `backfill.ts`; see the TODO comment at the relevant spot. For now, manually `DELETE FROM vault_chunks WHERE note_path = '<orphan>'` if a deleted-note's chunks are persistently noisy.)

## Detecting staleness

The store and the vault should agree on note count to a small constant. To check:

```
# total chunks
docker compose run --rm vault-indexer sqlite3 /var/lib/vault-indexer/vectors.db \
  'SELECT count(*) FROM vault_chunks;'

# distinct notes
docker compose run --rm vault-indexer sqlite3 /var/lib/vault-indexer/vectors.db \
  'SELECT count(DISTINCT note_path) FROM vault_chunks;'

# vault size (from MCP server logs after a list_notes)
```

If distinct-note-count is materially lower than vault size, recent notes haven't been indexed — check the indexer's logs for failures. If it's higher, you have orphans — run backfill.

## How to force a full re-index

The safe path:

```
gcloud compute ssh <vm> --command 'cd /opt/obsidian && sudo docker compose stop vault-indexer'
gcloud compute ssh <vm> --command 'sudo rm /opt/vault-indexer/data/vectors.db'
gcloud compute ssh <vm> --command 'cd /opt/obsidian && sudo docker compose start vault-indexer'
scripts/vault-indexer/run-backfill.sh --project <id>
```

Deleting the file is reversible up to the last vault sync — the source of truth is CouchDB; the SQLite file is a derived index that the backfill reproduces from scratch.
