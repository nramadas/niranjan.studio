import { Effect, Redacted } from "effect";
import { encryptWithEphemeralSalt } from "octagonal-wheels/encryption/hkdf.js";
import { EncryptionError } from "../../lib/errors/EncryptionError";
import { ENCRYPTED_PREFIXES } from "../constants.ts";

const isEncrypted = (s: string): boolean => ENCRYPTED_PREFIXES.some((p) => s.startsWith(p));

// Match the LiveSync default for new writes: HKDF ephemeral salt. Notes
// produced this way decrypt cleanly on every supported plugin version.
// Idempotent: if the input already carries an encryption prefix, return
// it unchanged.
const encryptDispatch = async (plain: string, passphrase: string): Promise<string> => {
  if (isEncrypted(plain)) return plain;
  return encryptWithEphemeralSalt(plain, passphrase);
};

/**
 * Encrypt a string (a note path or a chunk body) using the LiveSync
 * passphrase and an ephemeral salt. Idempotent for already-encrypted
 * inputs — pass-through when the value already carries an encryption
 * prefix.
 *
 * @param plain         The plaintext to encrypt.
 * @param passphrase    The LiveSync E2EE passphrase, redacted.
 * @param pathForError  The vault-relative path being written, used only
 *                      in the error payload for debugging.
 * @returns             An Effect that yields the encrypted string. Fails
 *                      with EncryptionError on cryptographic primitive
 *                      failure.
 */
export const encryptField = (
  plain: string,
  passphrase: Redacted.Redacted<string>,
  pathForError: string,
): Effect.Effect<string, EncryptionError> =>
  Effect.tryPromise({
    try: () => encryptDispatch(plain, Redacted.value(passphrase)),
    catch: (cause) =>
      new EncryptionError({
        path: pathForError,
        message: cause instanceof Error ? cause.message : String(cause),
        cause,
      }),
  });
