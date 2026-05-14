# MCP tool reference

The server exposes nine tools. Each one's description and input schema are also surfaced to Claude through the MCP `tools/list` response — you don't normally need to memorise them, just call the tool and let Claude pick.

## Choosing a write tool

There are four write tools and they aren't interchangeable:

- `edit_note` — change a small region of the body via find/replace. Best for targeted fixes; preserves the surrounding content exactly and avoids the latency of resending the full body.
- `append_to_note` — add content to the end. Useful for daily-note workflows.
- `update_note` — replace the body wholesale, patch frontmatter, or both. Use when the change touches frontmatter, or when most of the body is changing anyway.
- `create_note` — make a new note. Fails if one already exists at the path.

Avoid `delete_note` + `create_note` as a way to edit; use one of the in-place tools above.

## `list_notes`

List notes in the vault, optionally filtered by folder prefix. Returns paths and titles only — call `read_note` for the contents.

Input:
- `folder_prefix` (optional string): vault-relative path prefix, e.g. `Daily/`.
- `limit` (optional number, default 100, max 500): cap on results.

Returns: `[{ path, title, mtime, size }]`.

Use when you need an overview of the vault or want to discover notes under a specific folder.

## `read_note`

Read a single note by its vault-relative path. Returns parsed YAML frontmatter as a structured object plus the note body as a string.

Input:
- `path` (string): e.g. `Daily/2026-05-01.md`.

Returns: `{ path, _rev, frontmatter, body, mtime, ctime, size }`.

Fails with `NoteNotFoundError` if the note doesn't exist.

## `search_notes`

Full-text search across the entire vault using a BM25 index over note titles (weighted 2x) and bodies. Returns ranked results with relevance scores and a snippet around the first matching token.

Input:
- `query` (string): free-text query. Tokenised on whitespace and punctuation.
- `limit` (optional number, default 10, max 50).

Returns: `[{ path, title, score, snippet }]`.

Prefer this over `list_notes` + `read_note` when you don't know the exact path but remember keywords from the content.

## `create_note`

Create a new note. Fails with `NoteConflictError` if one already exists at that path — use `update_note` for existing notes.

Input:
- `path` (string).
- `body` (string): markdown body, may be empty.
- `frontmatter` (optional object): flat key/value YAML frontmatter. Renders to `---\nkey: value\n---` at the top.
  - Array values produce YAML inline-flow sequences. `{ "tags": ["draft", "idea"] }` becomes `tags: [draft, idea]`, which Obsidian parses as a real list.
  - Strings, numbers, booleans, and null are written as YAML scalars. Strings containing colons, brackets, or other YAML-reserved characters are quoted automatically.

Returns: the created `NoteRead`.

The note is encrypted with the LiveSync passphrase before being written. LiveSync clients pick it up on their next sync.

## `update_note`

Update an existing note's body, frontmatter, or both.

Input:
- `path` (string).
- `body` (optional string): replaces the body. If omitted, the body is preserved.
- `frontmatter` (optional object): patch merged with the existing frontmatter (existing keys are overwritten by patch values, untouched keys are preserved). Same value-handling rules as `create_note`: arrays render as inline YAML sequences, scalars as YAML scalars, ambiguous strings get auto-quoted.

Returns: the updated `NoteRead`.

Use this when you need to rewrite the body wholesale, or change frontmatter, or both. For small in-place body edits, prefer `edit_note` — it's cheaper and reduces the risk of accidentally rewriting unchanged content.

Conflict-aware: reads current revision, retries once on a 409, then surfaces `NoteConflictError`. Fails with `NoteNotFoundError` if the path doesn't exist.

## `append_to_note`

Append a block of content to the end of an existing note. Frontmatter is preserved. Useful for daily-note workflows.

Input:
- `path` (string).
- `content` (string): block of markdown to append. A newline is inserted between the existing body and the appended content if the body doesn't already end with one.

Returns: the updated `NoteRead`.

## `edit_note`

Apply a find/replace edit to a note's body without rewriting the whole note. Preserves everything outside the match exactly, so it's the right call for targeted fixes and minimises the chance of accidentally clobbering surrounding content.

Input:
- `path` (string).
- `old_string` (string): exact substring to replace. Whitespace and newlines match literally — copy the exact text from a prior `read_note` call.
- `new_string` (string): replacement text. May be empty to delete the matched region.
- `replace_all` (optional boolean, default `false`): when true, replaces every occurrence in the body. When false, fails with `StringMatchError` if `old_string` appears more than once.

Returns: the updated `NoteRead`.

Frontmatter is not searched — `old_string` only matches body content. To change frontmatter, use `update_note`.

Fails with `NoteNotFoundError` if the path doesn't exist, or `StringMatchError` with `reason: "not_found"` if `old_string` isn't present, or `reason: "ambiguous"` (plus an `occurrences` count) if it appears multiple times with `replace_all: false`.

## `delete_note`

Soft-delete: moves the note to `.trash/<original-path>` inside the vault. Manually empty `.trash/` from Obsidian when you're sure.

Input:
- `path` (string).

Returns: `{ ok: true, path }`.

## `list_recent_changes`

Return the N most recently modified notes, most-recent first. Useful for picking up where you left off.

Input:
- `limit` (optional number, default 20, max 100).

Returns: `[{ path, title, mtime, size }]`.

## Errors

All tools surface tagged errors as structured `isError: true` tool results rather than HTTP failures. Possible tags:

- `NoteNotFoundError { path }`
- `NoteConflictError { path, message }`
- `StringMatchError { path, reason, occurrences }` — surfaced by `edit_note` when `old_string` isn't found (`reason: "not_found"`) or appears more than once with `replace_all: false` (`reason: "ambiguous"`). The `occurrences` field is the exact count.
- `DecryptionError { docId, message }` — usually means the LiveSync passphrase doesn't match what was used to encrypt the doc. See [troubleshooting.md](troubleshooting.md).
- `EncryptionError { path, message }` — write-side counterpart.
- `CouchDbError { op, status, message }`
- `AuthError { reason, statusCode }` — surfaced as HTTP 401/403 before the tool handler runs.
- `ValidationError { field, message }` — input schema violation.
