-- ─── sqlite-vec schema for the vault indexer ───────────────────────────────
--
-- vec0 is a virtual table that stores a fixed-dimensionality vector per
-- row alongside arbitrary metadata. We use it as the *only* table for
-- chunk storage; there is no parallel non-virtual companion table.
--
-- Column kinds in vec0:
--   - Plain columns (no prefix) are "metadata" — they accept TEXT /
--     INTEGER / REAL and support WHERE filters in KNN queries
--     (the planner can prune the candidate set before computing
--     distances). We use them for note_path and chunk_hash because both
--     drive the diff path (`DELETE WHERE note_path = ?`,
--     `WHERE chunk_hash IN (...)`).
--   - "+" prefixed columns are "auxiliary" — opaque blobs returnable in
--     SELECT but not filterable. Cheaper to store, fine for chunk_text
--     and chunk_index which we want back from a KNN query but never
--     filter on.
--   - "embedding" carries the actual vector at the declared
--     dimensionality. Dimensionality is encoded in the schema: changing
--     models with a different dim is a destructive schema change, not a
--     drop-in swap. The taintedness check at boot (see openVectorStore)
--     enforces this.
--
-- Distance metric: default L2. Embedders normalise their vectors to unit
-- length before insertion, so L2 ordering equals cosine ordering. This
-- avoids depending on an inline `distance_metric=cosine` clause whose
-- exact syntax has shifted across sqlite-vec versions.

CREATE VIRTUAL TABLE IF NOT EXISTS vault_chunks USING vec0(
  embedding   FLOAT[384],
  note_path   TEXT,
  chunk_hash  TEXT,
  +note_revision TEXT,
  +chunk_index   INTEGER,
  +chunk_text    TEXT,
  +created_at    INTEGER
);

-- index_meta carries a single row keyed by `key`. It records which model
-- the on-disk vectors were produced by, so a container with a mismatched
-- EMBEDDER setting fails loud at boot rather than silently mixing two
-- models' vectors. Keys we read:
--   - embedding_model    (e.g. "bge-small-en-v1.5")
--   - embedding_version  (e.g. "Xenova/bge-small-en-v1.5@quantized")
--   - embedding_dim      (e.g. "384")

CREATE TABLE IF NOT EXISTS index_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
