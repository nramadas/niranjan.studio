import { describe, expect, it } from "vitest";
import { chunkId } from "./index.ts";

describe("chunkId", () => {
  it("returns an h:-prefixed hex SHA-256 of the content", async () => {
    const id = await chunkId("hello");
    expect(id.startsWith("h:")).toBe(true);
    // SHA-256 hex is 64 chars; plus "h:" = 66.
    expect(id).toHaveLength(66);
  });

  it("is deterministic for the same input", async () => {
    expect(await chunkId("foo")).toBe(await chunkId("foo"));
  });

  it("differs for different inputs", async () => {
    expect(await chunkId("foo")).not.toBe(await chunkId("bar"));
  });
});
