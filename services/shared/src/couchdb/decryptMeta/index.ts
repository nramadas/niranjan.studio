import { Effect, Redacted } from "effect";
import { decrypt as decryptHkdf } from "octagonal-wheels/encryption/hkdf.js";
import { DecryptionError } from "../../lib/errors/DecryptionError";
import { ENCRYPTED_META_PREFIX } from "../constants.ts";

/**
 * The metadata blob LiveSync stores inside the encrypted `path` field
 * when path obfuscation is on. Mirrors `EncryptProps` in
 * livesync-commonlib's pouchdb/encryption.ts.
 */
export interface DecryptedMeta {
  readonly path: string;
  readonly mtime: number;
  readonly ctime: number;
  readonly size: number;
  readonly children?: ReadonlyArray<string>;
}

/**
 * Decrypt the obfuscated `path` field on a note doc into the underlying
 * metadata blob. The format is `"/\\:" + HKDF(JSON({ path, mtime, ctime,
 * size, children }))` per livesync-commonlib's pouchdb/encryption.ts.
 *
 * Returns undefined when the input doesn't carry the prefix — that means
 * the doc isn't using path obfuscation and the caller should read the
 * doc-level fields directly.
 *
 * @param metaField  The raw `path` field on the note doc.
 * @param passphrase The LiveSync E2EE passphrase, redacted.
 * @param pbkdf2Salt The plugin's master PBKDF2 salt.
 * @param docId      Used only in the error payload for debugging.
 * @returns          An Effect that yields the parsed metadata, or
 *                   undefined if the field isn't an obfuscated-meta blob.
 *                   Fails with DecryptionError on crypto or JSON failure.
 */
export const decryptMeta = (
  metaField: string,
  passphrase: Redacted.Redacted<string>,
  pbkdf2Salt: Uint8Array<ArrayBuffer>,
  docId: string,
): Effect.Effect<DecryptedMeta | undefined, DecryptionError> => {
  if (!metaField.startsWith(ENCRYPTED_META_PREFIX)) return Effect.succeed(undefined);
  const ciphertext = metaField.slice(ENCRYPTED_META_PREFIX.length);
  return Effect.tryPromise({
    try: async () => {
      const json = await decryptHkdf(ciphertext, Redacted.value(passphrase), pbkdf2Salt);
      const parsed = JSON.parse(json) as Partial<DecryptedMeta>;
      if (typeof parsed.path !== "string") {
        throw new Error("decryptMeta: missing `path` in decrypted blob");
      }
      return {
        path: parsed.path,
        mtime: typeof parsed.mtime === "number" ? parsed.mtime : 0,
        ctime: typeof parsed.ctime === "number" ? parsed.ctime : 0,
        size: typeof parsed.size === "number" ? parsed.size : 0,
        children: Array.isArray(parsed.children) ? (parsed.children as string[]) : undefined,
      };
    },
    catch: (cause) =>
      new DecryptionError({
        docId,
        message: `decryptMeta: ${cause instanceof Error ? cause.message : String(cause)}`,
        cause,
      }),
  });
};
