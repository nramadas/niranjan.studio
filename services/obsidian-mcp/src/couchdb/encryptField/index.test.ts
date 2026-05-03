import { describe, expect, it } from "vitest";
import { Effect, Redacted } from "effect";
import { decrypt as decryptHkdf } from "octagonal-wheels/encryption/hkdf.js";
import { encryptField } from "./index.ts";

const passphrase = Redacted.make("test-passphrase");

const fixedSalt = (() => {
  const ab = new ArrayBuffer(32);
  const v = new Uint8Array(ab);
  for (let i = 0; i < 32; i++) v[i] = i;
  return v;
})();

describe("encryptField", () => {
  it("produces an HKDF fixed-salt prefixed ciphertext that round-trips", async () => {
    const ciphertext = await Effect.runPromise(
      encryptField("hello world", passphrase, fixedSalt, "Note.md"),
    );
    expect(ciphertext.startsWith("%=")).toBe(true);
    const round = await decryptHkdf(ciphertext, "test-passphrase", fixedSalt);
    expect(round).toBe("hello world");
  });

  it("is idempotent for already-encrypted input (passthrough)", async () => {
    const ciphertext = await Effect.runPromise(
      encryptField("hello", passphrase, fixedSalt, "Note.md"),
    );
    const second = await Effect.runPromise(
      encryptField(ciphertext, passphrase, fixedSalt, "Note.md"),
    );
    expect(second).toBe(ciphertext);
  });

  it("produces different ciphertexts on repeated calls (random IV + HKDF salt per call)", async () => {
    const a = await Effect.runPromise(encryptField("hello", passphrase, fixedSalt, "Note.md"));
    const b = await Effect.runPromise(encryptField("hello", passphrase, fixedSalt, "Note.md"));
    expect(a).not.toBe(b);
  });
});
