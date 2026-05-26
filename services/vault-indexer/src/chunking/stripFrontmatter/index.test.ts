import { describe, expect, it } from "vitest";
import { stripFrontmatter } from "./index.ts";

describe("stripFrontmatter", () => {
  it("removes a leading frontmatter block", () => {
    expect(stripFrontmatter("---\ntitle: x\n---\nbody")).toBe("body");
  });

  it("leaves body without frontmatter unchanged", () => {
    expect(stripFrontmatter("# Heading\nbody")).toBe("# Heading\nbody");
  });

  it("does not strip frontmatter that does not start at byte 0", () => {
    expect(stripFrontmatter("preamble\n---\ntitle: x\n---\nbody")).toBe(
      "preamble\n---\ntitle: x\n---\nbody",
    );
  });

  it("leaves malformed frontmatter unchanged", () => {
    expect(stripFrontmatter("---\ntitle: x\nno-close")).toBe("---\ntitle: x\nno-close");
  });

  it("handles a frontmatter block followed by no body", () => {
    expect(stripFrontmatter("---\ntitle: x\n---\n")).toBe("");
  });
});
