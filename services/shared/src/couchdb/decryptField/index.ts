import { Effect, Redacted } from "effect";
import { decrypt as decryptLegacy } from "octagonal-wheels/encryption/encryption.js";
import {
  decrypt as decryptHkdf,
  decryptWithEphemeralSalt,
} from "octagonal-wheels/encryption/hkdf.js";
import { DecryptionError } from "../../lib/errors/DecryptionError";
import { ENCRYPTED_PREFIXES, PREFIX_HKDF_EPHEMERAL, PREFIX_HKDF_FIXED } from "../constants.ts";

const isEncrypted = (s: string): boolean => ENCRYPTED_PREFIXES.some((p) => s.startsWith(p));

// Format dispatch matching livesync-commonlib's stringEncryption.ts.
// `%=` (HKDF fixed-salt) is the current LiveSync default and what the
// plugin in `E2EEAlgorithm: "v2"` mode produces. `%$` (HKDF ephemeral
// salt) is the older mode where the salt rides along in the ciphertext;
// kept here so we can still read mixed-vintage data. Legacy `%~`/`%`
// formats fall through to `decryptLegacy`.
const decryptDispatch = async (
  encrypted: string,
  passphrase: string,
  pbkdf2Salt: Uint8Array<ArrayBuffer>,
): Promise<string> => {
  if (encrypted.startsWith(PREFIX_HKDF_FIXED)) {
    return decryptHkdf(encrypted, passphrase, pbkdf2Salt);
  }
  if (encrypted.startsWith(PREFIX_HKDF_EPHEMERAL)) {
    return decryptWithEphemeralSalt(encrypted, passphrase);
  }
  // Legacy V2/V3: %~ … or % …
  try {
    return await decryptLegacy(encrypted, passphrase, false);
  } catch {
    return decryptLegacy(encrypted, passphrase, true);
  }
};

/**
 * Decrypt a chunk's `data` field (or any HKDF-encrypted blob) into
 * plaintext. Pass-through when the input doesn't carry an encryption
 * prefix — LiveSync stores some fields plaintext when encryption is off,
 * so the dispatch needs to handle both shapes.
 *
 * @param field      The raw field value as stored in CouchDB.
 * @param passphrase The LiveSync E2EE passphrase, redacted.
 * @param pbkdf2Salt The plugin's master PBKDF2 salt, read from
 *                   `_local/obsidian_livesync_sync_parameters` at boot.
 *                   Required for `%=` HKDF decryption; ignored for the
 *                   ephemeral-salt and legacy paths.
 * @param docId      The document `_id`, used only in the error payload
 *                   for debugging.
 * @returns          An Effect that yields the plaintext string. Fails
 *                   with DecryptionError if the format is unrecognised
 *                   or the passphrase is wrong.
 */
export const decryptField = (
  field: string,
  passphrase: Redacted.Redacted<string>,
  pbkdf2Salt: Uint8Array<ArrayBuffer>,
  docId: string,
): Effect.Effect<string, DecryptionError> => {
  if (!isEncrypted(field)) return Effect.succeed(field);
  return Effect.tryPromise({
    try: () => decryptDispatch(field, Redacted.value(passphrase), pbkdf2Salt),
    catch: (cause) =>
      new DecryptionError({
        docId,
        message: cause instanceof Error ? cause.message : String(cause),
        cause,
      }),
  });
};
