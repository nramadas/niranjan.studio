import { Effect } from "effect";
import { EncryptionError } from "../../lib/errors/EncryptionError";
import { PREFIX_OBFUSCATED } from "../constants.ts";

const utf8 = new TextEncoder();

const hexEncode = (bytes: Uint8Array): string =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

// SHA-256 with key.length stretching iterations. Matches LiveSync's
// `hashString` in src/lib/src/string_and_binary/path.ts upstream — note
// that the plugin's "stretching" is specifically `digest(buff)` re-hashed
// `key.length` times, which is what we replicate here.
const hashString = async (key: string): Promise<string> => {
  const buff = utf8.encode(key);
  let digest = await crypto.subtle.digest("SHA-256", buff);
  for (let i = 0; i < key.length; i++) {
    digest = await crypto.subtle.digest("SHA-256", buff);
  }
  return hexEncode(new Uint8Array(digest));
};

/**
 * Convert a vault path to its CouchDB document `_id`. When path
 * obfuscation is on (the LiveSync default for E2EE vaults), the body of
 * the id becomes a deterministic SHA-256 of `${hashedPassphrase}:${path}`,
 * preserving any `prefix:` segment in the original path.
 *
 * @param path                 The vault-relative path.
 * @param obfuscatePassphrase  The obfuscation passphrase, or `false` when
 *                             obfuscation is off (in which case the id is
 *                             essentially the path).
 * @param caseInsensitive      When true, lowercase the path before
 *                             hashing — matches the plugin's
 *                             `handleFilenameCaseSensitive` setting.
 * @returns                    An Effect that yields the derived document
 *                             id. Fails with EncryptionError on
 *                             cryptographic primitive failure.
 */
export const path2id = (
  path: string,
  obfuscatePassphrase: string | false,
  caseInsensitive = false,
): Effect.Effect<string, EncryptionError> =>
  Effect.tryPromise({
    try: async () => {
      const filename = caseInsensitive ? path.toLowerCase() : path;
      if (filename.startsWith(PREFIX_OBFUSCATED)) return filename;
      // Underscored paths get a `/` prefix in LiveSync; preserved here for
      // round-trip compatibility.
      let x = filename;
      if (x.startsWith("_")) x = `/${x}`;

      if (!obfuscatePassphrase) {
        return x;
      }
      // Split off any "prefix:" segment (e.g. "i:" for internal files).
      const sep = x.indexOf(":");
      const prefix = sep === -1 ? "" : `${x.slice(0, sep)}:`;
      const body = sep === -1 ? x : x.slice(sep + 1);
      if (body.startsWith(PREFIX_OBFUSCATED)) return `${prefix}${PREFIX_OBFUSCATED}${body}`;
      const hashedPassphrase = await hashString(obfuscatePassphrase);
      const out = await hashString(`${hashedPassphrase}:${filename}`);
      return `${prefix}${PREFIX_OBFUSCATED}${out}`;
    },
    catch: (cause) =>
      new EncryptionError({
        path,
        message: "failed to derive obfuscated _id from path",
        cause,
      }),
  });
