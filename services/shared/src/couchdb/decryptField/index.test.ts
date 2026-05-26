import { Effect, Exit, Redacted } from "effect";
import {
  encrypt as encryptHkdf,
  encryptWithEphemeralSalt,
} from "octagonal-wheels/encryption/hkdf.js";
import { describe, expect, it } from "vitest";
import { decryptField } from "./index.ts";

const passphrase = Redacted.make("test-passphrase");

const fixedSalt = (() => {
  const ab = new ArrayBuffer(32);
  const v = new Uint8Array(ab);
  for (let i = 0; i < 32; i++) v[i] = i;
  return v;
})();

describe("decryptField", () => {
  it("passes through plaintext that doesn't carry an encryption prefix", async () => {
    const out = await Effect.runPromise(decryptField("plain text", passphrase, fixedSalt, "h:abc"));
    expect(out).toBe("plain text");
  });

  it("decrypts an HKDF fixed-salt payload (the V2 LiveSync default)", async () => {
    const ciphertext = await encryptHkdf("the quick brown fox", "test-passphrase", fixedSalt);
    expect(ciphertext.startsWith("%=")).toBe(true);
    const out = await Effect.runPromise(decryptField(ciphertext, passphrase, fixedSalt, "h:abc"));
    expect(out).toBe("the quick brown fox");
  });

  it("still decrypts the older HKDF-ephemeral-salt format (mixed-vintage data)", async () => {
    const ciphertext = await encryptWithEphemeralSalt("ephemeral hello", "test-passphrase");
    const out = await Effect.runPromise(decryptField(ciphertext, passphrase, fixedSalt, "h:abc"));
    expect(out).toBe("ephemeral hello");
  });

  it("fails with DecryptionError when the passphrase is wrong", async () => {
    const ciphertext = await encryptHkdf("secret", "right-passphrase", fixedSalt);
    const exit = await Effect.runPromiseExit(
      decryptField(ciphertext, Redacted.make("wrong-passphrase"), fixedSalt, "h:abc"),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(JSON.stringify(exit.cause)).toContain("DecryptionError");
    }
  });
});
