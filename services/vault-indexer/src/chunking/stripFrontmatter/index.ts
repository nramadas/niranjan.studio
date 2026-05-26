/**
 * Strip a YAML frontmatter block (if present) from the start of a note
 * body before chunking. Frontmatter is structured metadata, not prose —
 * embedding it tends to drown out the meaningful content of short
 * notes (a note whose body is one paragraph would score primarily on
 * its frontmatter terms). Removing it before chunking keeps the
 * semantic search aligned with how a human would read the note.
 *
 * The frontmatter delimiter convention matches the Phase 2 Vault's
 * `parseFrontmatter`: a leading `---\n` and a closing `---\n` with YAML
 * in between. Anything else (no leading `---`, malformed close)
 * passes through unchanged.
 *
 * @param body Raw note text including any frontmatter.
 * @returns The body with the frontmatter block removed.
 */
export const stripFrontmatter = (body: string): string => {
  if (!body.startsWith("---\n")) return body;
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(body);
  if (!match) return body;
  return body.slice(match[0].length);
};
