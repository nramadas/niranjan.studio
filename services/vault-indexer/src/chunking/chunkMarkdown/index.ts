import { sha256Hash } from "../sha256Hash";
import { stripFrontmatter } from "../stripFrontmatter";
import { tokenEstimate } from "../tokenEstimate";
import type { ChunkingParameters, NoteChunk } from "../types.ts";

interface Block {
  readonly text: string;
  readonly start: number;
  readonly end: number;
}

const ATX_HEADER = /^#{1,6} /;

// Split body into "sections" — each section either starts with an ATX
// header or starts at the body's start (the implicit pre-header section).
// Each section keeps the header line attached. We never split across
// a header boundary; if a section is oversized, we paragraph-pack inside it.
const splitSections = (body: string): Block[] => {
  const lines = body.split("\n");
  const sections: Block[] = [];
  let lineStart = 0;
  let secStart = 0;
  let secLines: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (ATX_HEADER.test(line) && secLines.length > 0) {
      const text = secLines.join("\n");
      sections.push({ text, start: secStart, end: secStart + Buffer.byteLength(text, "utf8") });
      secStart = lineStart;
      secLines = [];
    }
    secLines.push(line);
    lineStart += Buffer.byteLength(line, "utf8") + 1; // +1 for the newline
  }
  if (secLines.length > 0) {
    const text = secLines.join("\n");
    sections.push({ text, start: secStart, end: secStart + Buffer.byteLength(text, "utf8") });
  }
  return sections;
};

// Split a section on blank-line paragraph boundaries. Returns blocks
// whose `text` does NOT include the trailing blank line; offsets are
// relative to the section's text (caller adjusts to absolute).
const splitParagraphs = (sectionText: string, sectionStart: number): Block[] => {
  const out: Block[] = [];
  let cursor = 0;
  while (cursor < sectionText.length) {
    let boundary = sectionText.indexOf("\n\n", cursor);
    if (boundary === -1) boundary = sectionText.length;
    const text = sectionText.slice(cursor, boundary);
    if (text.length > 0) {
      out.push({
        text,
        start: sectionStart + cursor,
        end: sectionStart + cursor + text.length,
      });
    }
    cursor = boundary + 2;
  }
  return out;
};

const packBlocks = (blocks: ReadonlyArray<Block>, params: ChunkingParameters): Block[] => {
  const out: Block[] = [];
  if (blocks.length === 0) return out;

  let bufText: string[] = [];
  let bufStart = blocks[0]?.start ?? 0;
  let bufEnd = bufStart;
  let bufTokens = 0;

  const flush = () => {
    if (bufText.length === 0) return;
    const text = bufText.join("\n\n");
    out.push({ text, start: bufStart, end: bufEnd });
    bufText = [];
  };

  for (const block of blocks) {
    const blockTokens = tokenEstimate(block.text);

    // A single block larger than the target on its own gets emitted as
    // its own chunk. The packer doesn't try to mid-paragraph-split:
    // markdown is the structural unit. A pathologically long paragraph
    // will dominate one chunk; the retrieval cost is small and the
    // alternative (mid-token splits) hurts embedding quality more.
    if (blockTokens >= params.target) {
      flush();
      out.push({ text: block.text, start: block.start, end: block.end });
      bufStart = block.end;
      bufEnd = block.end;
      bufTokens = 0;
      continue;
    }

    if (bufTokens + blockTokens > params.target && bufTokens >= params.min) {
      flush();
      bufStart = block.start;
      bufEnd = block.end;
      bufTokens = blockTokens;
      bufText.push(block.text);
      continue;
    }

    if (bufText.length === 0) bufStart = block.start;
    bufText.push(block.text);
    bufEnd = block.end;
    bufTokens += blockTokens;
  }

  flush();
  return out;
};

// Attach a tail of the previous chunk to the head of the next, up to
// `params.overlap` tokens of overlap. Implemented in a second pass so
// the packing logic stays simple.
const applyOverlap = (chunks: ReadonlyArray<Block>, params: ChunkingParameters): Block[] => {
  if (params.overlap <= 0 || chunks.length < 2) return [...chunks];
  const out: Block[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const cur = chunks[i];
    if (!cur) continue;
    if (i === 0) {
      out.push(cur);
      continue;
    }
    const prev = chunks[i - 1];
    if (!prev) {
      out.push(cur);
      continue;
    }
    const overlapChars = Math.min(params.overlap * 4, prev.text.length);
    const tail = prev.text.slice(prev.text.length - overlapChars);
    const text = `${tail}\n\n${cur.text}`;
    // Keep the offsets reporting the new chunk's *primary* span, not the
    // duplicated tail — overlapping byte ranges in the offsets would
    // confuse downstream callers that want unique source coverage.
    out.push({ text, start: cur.start, end: cur.end });
  }
  return out;
};

/**
 * Split a markdown note body into chunks suitable for embedding.
 *
 * Strategy:
 *   1. Strip frontmatter — structured metadata, not prose.
 *   2. Split on ATX headers (each `# `-prefixed line starts a new section).
 *   3. Within each section, split on blank-line paragraph boundaries.
 *   4. Greedily pack paragraphs up to `params.target` tokens, never
 *      splitting a paragraph and never crossing a header.
 *   5. Apply `params.overlap` tokens of trailing overlap from chunk N-1
 *      into chunk N so a query straddling a chunk boundary recalls both.
 *
 * Token counts are estimates — see `tokenEstimate`. The embedder sees
 * the real text, so the estimate matters only for chunk-shape granularity.
 *
 * @param body   The note body (frontmatter included; stripped internally).
 * @param params Tuning knobs from `chunkingConfig`.
 * @returns      One or more `NoteChunk`s with stable hashes.
 *               Empty bodies (after frontmatter strip) yield zero chunks.
 */
export const chunkMarkdown = (
  body: string,
  params: ChunkingParameters,
): ReadonlyArray<NoteChunk> => {
  const stripped = stripFrontmatter(body);
  if (stripped.trim().length === 0) return [];

  const sections = splitSections(stripped);
  const allBlocks: Block[] = [];
  for (const section of sections) {
    if (tokenEstimate(section.text) <= params.target) {
      allBlocks.push(section);
    } else {
      const paragraphs = splitParagraphs(section.text, section.start);
      for (const p of paragraphs) allBlocks.push(p);
    }
  }

  const packed = packBlocks(allBlocks, params);
  const withOverlap = applyOverlap(packed, params);

  return withOverlap.map((c, idx) => ({
    index: idx,
    text: c.text,
    hash: sha256Hash(c.text),
    charStart: c.start,
    charEnd: c.end,
  }));
};
