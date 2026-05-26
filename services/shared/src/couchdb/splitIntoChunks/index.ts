/**
 * Split a note body into fixed-size chunks for storage as LiveSync chunk
 * leaves. The plugin uses content-defined chunking client-side; we use a
 * simpler fixed-size split because content-defined chunking requires
 * format detail we'd need to keep in sync with the plugin's evolving
 * algorithm. Dedup is approximate as a result — the plugin's
 * normalisation pass converges on its preferred chunk shape on the next
 * sync cycle.
 *
 * Default chunk size 8 KiB matches the plugin's `customChunkSize` default
 * for plain text.
 *
 * @param body      The plaintext note body (frontmatter included if any).
 * @param chunkSize Maximum characters per chunk. Defaults to 8 KiB.
 * @returns         Array of chunk strings, ordered to be concatenated by
 *                  `assembleChunks` to recover the original body.
 */
export const splitIntoChunks = (body: string, chunkSize = 8 * 1024): string[] => {
  if (body.length <= chunkSize) return [body];
  const out: string[] = [];
  for (let i = 0; i < body.length; i += chunkSize) {
    out.push(body.slice(i, i + chunkSize));
  }
  return out;
};
