import { describe, expect, it } from "vitest";
import { DecryptionError } from "./index.ts";

describe("DecryptionError", () => {
  it("carries the tag, docId, and message", () => {
    const err = new DecryptionError({ docId: "h:abc123", message: "bad passphrase" });
    expect(err._tag).toBe("DecryptionError");
    expect(err.docId).toBe("h:abc123");
    expect(err.message).toBe("bad passphrase");
  });
});
