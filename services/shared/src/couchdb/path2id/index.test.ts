import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { path2id } from "./index.ts";

describe("path2id", () => {
  it("returns the path unchanged when obfuscation is off", async () => {
    const id = await Effect.runPromise(path2id("Daily/2026-05-02.md", false));
    expect(id).toBe("Daily/2026-05-02.md");
  });

  it("prefixes underscored paths with /", async () => {
    const id = await Effect.runPromise(path2id("_template.md", false));
    expect(id).toBe("/_template.md");
  });

  it("returns an f:-prefixed deterministic hash when obfuscation is on", async () => {
    const id = await Effect.runPromise(path2id("Daily/note.md", "passphrase"));
    expect(id.startsWith("f:")).toBe(true);
    // Hex digest is 64 chars; with the f: prefix that's 66.
    expect(id).toHaveLength(66);
  });

  it("is deterministic for the same inputs", async () => {
    const a = await Effect.runPromise(path2id("Notes/x.md", "passphrase"));
    const b = await Effect.runPromise(path2id("Notes/x.md", "passphrase"));
    expect(a).toBe(b);
  });

  it("differs across distinct paths under the same passphrase", async () => {
    const a = await Effect.runPromise(path2id("Notes/x.md", "passphrase"));
    const b = await Effect.runPromise(path2id("Notes/y.md", "passphrase"));
    expect(a).not.toBe(b);
  });

  it("preserves a prefix: segment from the input", async () => {
    const id = await Effect.runPromise(path2id("i:internal/path.md", "passphrase"));
    expect(id.startsWith("i:f:")).toBe(true);
  });

  it("is a no-op for already-obfuscated input", async () => {
    const id = await Effect.runPromise(path2id("f:abc123", "passphrase"));
    expect(id).toBe("f:abc123");
  });
});
