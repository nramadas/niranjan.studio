/**
 * Cheap token-count estimate from a character count: roughly 4 characters
 * per token for English Markdown. This is a heuristic — the bge-small
 * tokeniser sees the real text and produces real tokens at embed time, so
 * any drift here only affects chunk *sizing*, not retrieval quality.
 *
 * We use it instead of the real tokeniser because (a) running the
 * tokeniser on every paragraph boundary while packing would dominate
 * indexing time, and (b) a stable, fast heuristic is what the chunker
 * needs to make packing decisions.
 *
 * @param s The string to estimate.
 * @returns Estimated token count, rounded up.
 */
export const tokenEstimate = (s: string): number => Math.ceil(s.length / 4);
