import { describe, expect, it } from "vitest";
import { Effect, Redacted } from "effect";
import { decryptWithEphemeralSalt } from "octagonal-wheels/encryption/hkdf.js";
import { encryptField } from "./index.ts";

const passphrase = Redacted.make("test-passphrase");

describe("encryptField", () => {
  it("produces an HKDF-ephemeral-salt prefixed ciphertext that round-trips", async () => {
    const ciphertext = await Effect.runPromise(encryptField("hello world", passphrase, "Note.md"));
    expect(ciphertext.startsWith("%$")).toBe(true);
    const round = await decryptWithEphemeralSalt(ciphertext, "test-passphrase");
    expect(round).toBe("hello world");
  });

  it("is idempotent for already-encrypted input (passthrough)", async () => {
    const ciphertext = await Effect.runPromise(encryptField("hello", passphrase, "Note.md"));
    const second = await Effect.runPromise(encryptField(ciphertext, passphrase, "Note.md"));
    expect(second).toBe(ciphertext);
  });

  it("produces different ciphertexts on repeated calls (ephemeral salt)", async () => {
    const a = await Effect.runPromise(encryptField("hello", passphrase, "Note.md"));
    const b = await Effect.runPromise(encryptField("hello", passphrase, "Note.md"));
    expect(a).not.toBe(b);
  });
});
