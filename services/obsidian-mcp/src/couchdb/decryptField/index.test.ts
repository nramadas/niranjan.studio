import { describe, expect, it } from "vitest";
import { Effect, Exit, Redacted } from "effect";
import { encryptWithEphemeralSalt } from "octagonal-wheels/encryption/hkdf.js";
import { decryptField } from "./index.ts";

const passphrase = Redacted.make("test-passphrase");

describe("decryptField", () => {
  it("passes through plaintext that doesn't carry an encryption prefix", async () => {
    const out = await Effect.runPromise(decryptField("plain text", passphrase, "h:abc"));
    expect(out).toBe("plain text");
  });

  it("decrypts an HKDF-ephemeral-salt payload produced by octagonal-wheels", async () => {
    const ciphertext = await encryptWithEphemeralSalt("the quick brown fox", "test-passphrase");
    const out = await Effect.runPromise(decryptField(ciphertext, passphrase, "h:abc"));
    expect(out).toBe("the quick brown fox");
  });

  it("fails with DecryptionError when the passphrase is wrong", async () => {
    const ciphertext = await encryptWithEphemeralSalt("secret", "right-passphrase");
    const exit = await Effect.runPromiseExit(
      decryptField(ciphertext, Redacted.make("wrong-passphrase"), "h:abc"),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(JSON.stringify(exit.cause)).toContain("DecryptionError");
    }
  });

  it("fails with a clear DecryptionError when given the unsupported HKDF fixed-salt format", async () => {
    const exit = await Effect.runPromiseExit(
      decryptField("%=somefakedata", passphrase, "h:abc"),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(JSON.stringify(exit.cause)).toContain("HKDF fixed-salt format");
    }
  });
});
