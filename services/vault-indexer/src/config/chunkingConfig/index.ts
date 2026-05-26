import { Config } from "effect";

/**
 * Typed config for the markdown chunker. Tokens are estimated via a
 * cheap character-count heuristic (~4 chars/token for English) — see
 * `chunking/tokenEstimate`. The estimate matters only for chunk sizing;
 * the embedder itself sees real text, so the heuristic's drift doesn't
 * affect retrieval quality, only chunk-shape granularity.
 *
 * `target`  — preferred chunk size; the packer tries to land near this.
 * `overlap` — tokens of trailing content carried into the next chunk so a
 *             query that straddles a chunk boundary still recalls both
 *             chunks meaningfully.
 * `min`     — chunks shorter than this are merged into their neighbour
 *             rather than emitted as is. Prevents one-line stub chunks
 *             from dominating early in low-relevance KNN results.
 *
 * All three are tunable so users can experiment without a recompile.
 * Defaults are the spec's 384/50/64.
 */
export const chunkingConfig = Config.all({
  target: Config.integer("CHUNK_TOKEN_TARGET").pipe(Config.withDefault(384)),
  overlap: Config.integer("CHUNK_TOKEN_OVERLAP").pipe(Config.withDefault(50)),
  min: Config.integer("CHUNK_TOKEN_MIN").pipe(Config.withDefault(64)),
});
