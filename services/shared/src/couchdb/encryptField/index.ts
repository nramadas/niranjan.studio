import { Effect, Redacted } from "effect";
import { encrypt as encryptHkdf } from "octagonal-wheels/encryption/hkdf.js";
import { EncryptionError } from "../../lib/errors/EncryptionError";
import { ENCRYPTED_PREFIXES } from "../constants.ts";

const isEncrypted = (s: string): boolean => ENCRYPTED_PREFIXES.some((p) => s.startsWith(p));

// Emit HKDF fixed-salt format (`%=`) so the LiveSync plugin in
// `E2EEAlgorithm: "v2"` mode decrypts our writes. The salt is the
// master PBKDF2 salt the plugin set in `_local/obsidian_livesync_sync_parameters`
// at vault init; the IV and HKDF salt rotate per call (see
// octagonal-wheels' hkdf.encrypt), so identical plaintexts still produce
// distinct ciphertexts. Idempotent for already-encrypted inputs.
const encryptDispatch = async (
  plain: string,
  passphrase: string,
  pbkdf2Salt: Uint8Array<ArrayBuffer>,
): Promise<string> => {
  if (isEncrypted(plain)) return plain;
  return encryptHkdf(plain, passphrase, pbkdf2Salt);
};

/**
 * Encrypt a string (a chunk body or a metadata blob) using the LiveSync
 * passphrase and the master PBKDF2 salt. Output starts with `%=`.
 * Idempotent for already-encrypted inputs.
 *
 * @param plain         The plaintext to encrypt.
 * @param passphrase    The LiveSync E2EE passphrase, redacted.
 * @param pbkdf2Salt    The plugin's master PBKDF2 salt, read from
 *                      `_local/obsidian_livesync_sync_parameters` at boot.
 * @param pathForError  The vault-relative path being written, used only
 *                      in the error payload for debugging.
 * @returns             An Effect that yields the encrypted string. Fails
 *                      with EncryptionError on cryptographic primitive
 *                      failure.
 */
export const encryptField = (
  plain: string,
  passphrase: Redacted.Redacted<string>,
  pbkdf2Salt: Uint8Array<ArrayBuffer>,
  pathForError: string,
): Effect.Effect<string, EncryptionError> =>
  Effect.tryPromise({
    try: () => encryptDispatch(plain, Redacted.value(passphrase), pbkdf2Salt),
    catch: (cause) =>
      new EncryptionError({
        path: pathForError,
        message: cause instanceof Error ? cause.message : String(cause),
        cause,
      }),
  });
