import { describe, expect, it } from "vitest";
import { chunkId } from "./index.ts";

describe("chunkId", () => {
  it("returns an h:+-prefixed hex SHA-256 when the chunk will be encrypted", async () => {
    const id = await chunkId("hello", true);
    expect(id.startsWith("h:+")).toBe(true);
    // SHA-256 hex is 64 chars; plus "h:+" = 67.
    expect(id).toHaveLength(67);
  });

  it("returns an h:-prefixed (no plus) id for plaintext chunks", async () => {
    const id = await chunkId("hello", false);
    expect(id.startsWith("h:")).toBe(true);
    expect(id.startsWith("h:+")).toBe(false);
    expect(id).toHaveLength(66);
  });

  it("is deterministic for the same input + flag", async () => {
    expect(await chunkId("foo", true)).toBe(await chunkId("foo", true));
  });

  it("differs for different inputs", async () => {
    expect(await chunkId("foo", true)).not.toBe(await chunkId("bar", true));
  });

  it("differs between encrypted and plaintext for the same content", async () => {
    expect(await chunkId("foo", true)).not.toBe(await chunkId("foo", false));
  });
});
