import { describe, expect, it } from "vitest";
import { EncryptionError } from "./index.ts";

describe("EncryptionError", () => {
  it("carries the tag, path, and message", () => {
    const err = new EncryptionError({ path: "Notes/x.md", message: "key derivation failed" });
    expect(err._tag).toBe("EncryptionError");
    expect(err.path).toBe("Notes/x.md");
  });
});
