// Centralised "should this note be indexed for search?" predicate.
//
// Used by every service that builds an index for semantic or lexical
// search across the vault. Keeping the predicate here (not in each
// service) ensures the indexes can't disagree about what counts as
// trash — important for hybrid search, where lexical and semantic
// results are fused via RRF: if one side surfaces a trashed note and
// the other doesn't, the fused result still includes it at a mid rank.
//
// Current consumers:
//   - services/vault-indexer:
//       - changes/processChangeEvent filters live `_changes` events.
//       - backfill.ts filters the bulk readAllForIndex result, and
//         calls deleteByPath on excluded notes to clean up any chunks
//         that pre-existed the filter.
//   - services/obsidian-mcp:
//       - search/SearchIndexLayer filters the notes ingested into the
//         BM25 index.
//
// NOT applied at the Vault layer: the MCP server's read/write tools
// (read_note, list_notes, update_note, etc.) need to see trashed notes
// — restoring a note from .trash/ is a legitimate user operation. The
// filter is purely for SEARCH indexing, not for general vault access.

/**
 * Path prefixes whose notes are deliberately excluded from search
 * indexes. Each entry MUST include the trailing slash to avoid
 * matching a literal file or directory whose name happens to start
 * with the same characters (e.g. `.trashy.md`).
 */
export const EXCLUDED_PATH_PREFIXES = [".trash/"] as const;

/**
 * Returns true if `path` should be indexed; false if it matches any
 * excluded prefix.
 */
export const isIndexablePath = (path: string): boolean => {
  for (const prefix of EXCLUDED_PATH_PREFIXES) {
    if (path.startsWith(prefix)) return false;
  }
  return true;
};
