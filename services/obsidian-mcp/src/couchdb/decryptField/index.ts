import { Effect, Redacted } from "effect";
import { decrypt as decryptLegacy } from "octagonal-wheels/encryption/encryption.js";
import { decryptWithEphemeralSalt } from "octagonal-wheels/encryption/hkdf.js";
import { DecryptionError } from "../../lib/errors/DecryptionError";
import {
  ENCRYPTED_PREFIXES,
  PREFIX_HKDF_EPHEMERAL,
  PREFIX_HKDF_FIXED,
} from "../constants.ts";

const isEncrypted = (s: string): boolean => ENCRYPTED_PREFIXES.some((p) => s.startsWith(p));

// Format dispatch matching livesync-commonlib's stringEncryption.ts. We
// try the HKDF prefixes first (current default), then the legacy AES-GCM
// formats (V2/V3). The legacy decrypt is tried with both auto-iter
// settings since the plugin used to flip that flag.
const decryptDispatch = async (encrypted: string, passphrase: string): Promise<string> => {
  if (encrypted.startsWith(PREFIX_HKDF_EPHEMERAL)) {
    return decryptWithEphemeralSalt(encrypted, passphrase);
  }
  if (encrypted.startsWith(PREFIX_HKDF_FIXED)) {
    throw new Error(
      "HKDF fixed-salt format ('%=') is not supported by this server — re-encrypt the vault with the ephemeral-salt format from the LiveSync plugin's E2EE settings.",
    );
  }
  // Legacy V2/V3: %~ … or % …
  try {
    return await decryptLegacy(encrypted, passphrase, false);
  } catch {
    return decryptLegacy(encrypted, passphrase, true);
  }
};

/**
 * Decrypt a chunk's `data` field (or a note's encrypted `path`) into
 * plaintext. Pass-through when the input doesn't carry an encryption
 * prefix — LiveSync stores plaintext-equivalent fields without
 * re-encrypting them, so the dispatch needs to handle both shapes.
 *
 * @param field      The raw field value as stored in CouchDB.
 * @param passphrase The LiveSync E2EE passphrase, redacted.
 * @param docId      The document `_id`, used only in the error payload
 *                   for debugging.
 * @returns          An Effect that yields the plaintext string. Fails
 *                   with DecryptionError if the format is unrecognised
 *                   or the passphrase is wrong.
 */
export const decryptField = (
  field: string,
  passphrase: Redacted.Redacted<string>,
  docId: string,
): Effect.Effect<string, DecryptionError> => {
  if (!isEncrypted(field)) return Effect.succeed(field);
  return Effect.tryPromise({
    try: () => decryptDispatch(field, Redacted.value(passphrase)),
    catch: (cause) =>
      new DecryptionError({
        docId,
        message: cause instanceof Error ? cause.message : String(cause),
        cause,
      }),
  });
};
