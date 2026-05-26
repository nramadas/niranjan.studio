import { describe, expect, it } from "vitest";
import { chunkMarkdown } from "./index.ts";

const PARAMS = { target: 50, overlap: 5, min: 8 };

describe("chunkMarkdown", () => {
  it("returns an empty array for an empty body", () => {
    expect(chunkMarkdown("", PARAMS)).toEqual([]);
  });

  it("returns an empty array for whitespace-only body", () => {
    expect(chunkMarkdown("   \n\n  \n", PARAMS)).toEqual([]);
  });

  it("strips frontmatter before chunking", () => {
    const note = "---\ntitle: x\ntags: [a]\n---\nhello world";
    const chunks = chunkMarkdown(note, PARAMS);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.text).toBe("hello world");
  });

  it("emits one chunk for a short note", () => {
    const chunks = chunkMarkdown("a short note about cats", PARAMS);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.text).toBe("a short note about cats");
    expect(chunks[0]?.index).toBe(0);
    expect(chunks[0]?.hash).toMatch(/^[0-9a-f]{16}$/);
  });

  it("does not split across headers", () => {
    const note = [
      "# A",
      "alpha paragraph that is short",
      "",
      "# B",
      "beta paragraph that is short",
    ].join("\n");
    const chunks = chunkMarkdown(note, { target: 8, overlap: 0, min: 1 });
    // Two sections, each emitted as its own chunk (target small enough
    // that the packer doesn't combine them — but they wouldn't be
    // combined anyway because each section is a separate input block).
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(chunks.some((c) => c.text.startsWith("# A"))).toBe(true);
    expect(chunks.some((c) => c.text.startsWith("# B"))).toBe(true);
  });

  it("packs paragraphs up to the target size", () => {
    const para = "x".repeat(100); // 25 tokens
    const note = `${para}\n\n${para}\n\n${para}\n\n${para}`;
    // target=50 tokens → expect ~2 chunks of 2 paragraphs each
    const chunks = chunkMarkdown(note, { target: 50, overlap: 0, min: 8 });
    expect(chunks.length).toBe(2);
  });

  it("emits stable, content-addressed hashes", () => {
    const note = "hello\n\nworld";
    const a = chunkMarkdown(note, PARAMS);
    const b = chunkMarkdown(note, PARAMS);
    expect(a.map((c) => c.hash)).toEqual(b.map((c) => c.hash));
  });

  it("changes only affected chunk hashes when one paragraph is edited", () => {
    const para = "z".repeat(120); // ~30 tokens
    const original = [`# Title\n${para}`, para, "stable paragraph"].join("\n\n");
    const edited = [`# Title\n${para}`, `${para} (edited)`, "stable paragraph"].join("\n\n");
    const a = chunkMarkdown(original, { target: 30, overlap: 0, min: 8 });
    const b = chunkMarkdown(edited, { target: 30, overlap: 0, min: 8 });
    const aHashes = a.map((c) => c.hash);
    const bHashes = b.map((c) => c.hash);
    // At least one chunk hash must be common — the unedited segments.
    const common = aHashes.filter((h) => bHashes.includes(h));
    expect(common.length).toBeGreaterThan(0);
  });

  it("applies overlap between consecutive chunks", () => {
    const para = "z".repeat(120);
    const note = `${para}\n\n${para}\n\n${para}`;
    const noOverlap = chunkMarkdown(note, { target: 30, overlap: 0, min: 1 });
    const withOverlap = chunkMarkdown(note, { target: 30, overlap: 10, min: 1 });
    expect(withOverlap.length).toBe(noOverlap.length);
    // The second chunk under overlap should be longer (carries some tail
    // of the first).
    expect(withOverlap[1]?.text.length ?? 0).toBeGreaterThan(noOverlap[1]?.text.length ?? 0);
  });

  it("yields sequential indices", () => {
    const note = "a".repeat(500);
    const chunks = chunkMarkdown(note, { target: 20, overlap: 0, min: 4 });
    chunks.forEach((c, i) => expect(c.index).toBe(i));
  });
});
