import { Effect, Redacted } from "effect";
import { encrypt as encryptHkdf } from "octagonal-wheels/encryption/hkdf.js";
import { EncryptionError } from "../../lib/errors/EncryptionError";
import { ENCRYPTED_META_PREFIX } from "../constants.ts";

/**
 * Shape of the metadata blob LiveSync expects to find inside the
 * encrypted `path` field. Mirrors `EncryptProps` in
 * livesync-commonlib's pouchdb/encryption.ts.
 */
export interface EncryptableMeta {
  readonly path: string;
  readonly mtime: number;
  readonly ctime: number;
  readonly size: number;
  /** Real chunk id list. The doc-level `children` will be set to `[]`. */
  readonly children?: ReadonlyArray<string>;
}

/**
 * Build an obfuscated `path` field value: JSON-stringify the metadata,
 * HKDF-encrypt with the master salt, prepend the `/\\:` marker. The
 * caller stores the result in `doc.path` and zeroes out the doc-level
 * `mtime`/`ctime`/`size`/`children` to match what the plugin emits.
 *
 * @param props        The metadata to encrypt.
 * @param passphrase   The LiveSync E2EE passphrase, redacted.
 * @param pbkdf2Salt   The plugin's master PBKDF2 salt.
 * @param pathForError Used only in the error payload for debugging.
 */
export const encryptMeta = (
  props: EncryptableMeta,
  passphrase: Redacted.Redacted<string>,
  pbkdf2Salt: Uint8Array<ArrayBuffer>,
  pathForError: string,
): Effect.Effect<string, EncryptionError> =>
  Effect.tryPromise({
    try: async () => {
      const propStr = JSON.stringify({
        path: props.path,
        mtime: props.mtime,
        ctime: props.ctime,
        size: props.size,
        ...(props.children !== undefined ? { children: [...props.children] } : {}),
      });
      const ciphertext = await encryptHkdf(propStr, Redacted.value(passphrase), pbkdf2Salt);
      return `${ENCRYPTED_META_PREFIX}${ciphertext}`;
    },
    catch: (cause) =>
      new EncryptionError({
        path: pathForError,
        message: `encryptMeta: ${cause instanceof Error ? cause.message : String(cause)}`,
        cause,
      }),
  });
