// LiveSync E2EE wrapper.
//
// Self-hosted LiveSync stores notes as CouchDB documents in a specific
// shape:
//
//   - Note documents: type="newnote" or type="plain". Have a `path` field
//     and a `children: string[]` array of chunk document IDs. `_id` is
//     derived from the path; if path obfuscation is on, `_id` and `path`
//     are both prefixed with "f:" and the body of `_id` is a SHA-256
//     stretched hash of `${hashedPassphrase}:${path}`.
//
//   - Chunk documents (a.k.a. "leaves"): _id starts with "h:", type="leaf",
//     `data` is the chunk content (may be encrypted). Multiple notes can
//     share chunks via content-hash deduplication.
//
//   - When E2EE is on, the chunk `data` and the note `path` field are
//     encrypted with the LiveSync passphrase. The library
//     `octagonal-wheels` (which the LiveSync plugin itself depends on)
//     handles the AES-GCM + PBKDF2/HKDF encryption details. Encrypted
//     strings are tagged with a leading prefix:
//       - "%~"  V3 (legacy AES-GCM with auto-iter)
//       - "%"   V2 (legacy AES-GCM)
//       - "%="  HKDF, fixed salt
//       - "%$"  HKDF, ephemeral salt
//
// The path-to-id transform (path2id) is reimplemented here because it's a
// LiveSync-specific stretching algorithm (see
// `src/lib/src/string_and_binary/path.ts` upstream), not a function
// exported from octagonal-wheels.
//
// CAUTION: this is a faithful reimplementation of the LiveSync format as
// of plugin version pinned in docs/obsidian-mcp/troubleshooting.md. If the
// plugin's chunking format evolves (which it has historically), the
// server's reads will start returning gibberish or blanks. The
// architecture doc has the version-bumping recipe.

import { Effect, Redacted } from "effect";
import {
  decrypt as decryptLegacy,
  encrypt as encryptLegacy,
} from "octagonal-wheels/encryption/encryption.js";
import {
  decryptWithEphemeralSalt,
  encryptWithEphemeralSalt,
  HKDF_SALTED_ENCRYPTED_PREFIX,
} from "octagonal-wheels/encryption/hkdf.js";
import { DecryptionError, EncryptionError } from "../lib/errors.js";

export const PREFIX_OBFUSCATED = "f:" as const;
export const PREFIX_CHUNK = "h:" as const;

// Encryption prefixes used by the LiveSync plugin. Order matters for the
// startsWith dispatch — `%~` and `%=` and `%$` must be checked before the
// bare `%` legacy prefix.
const PREFIX_HKDF_EPHEMERAL = HKDF_SALTED_ENCRYPTED_PREFIX; // "%$"
const PREFIX_HKDF_FIXED = "%=" as const;
const PREFIX_LEGACY_V3 = "%~" as const;
const PREFIX_LEGACY_V2_PROBABLY = "%" as const;

export const ENCRYPTED_PREFIXES = [
  PREFIX_HKDF_EPHEMERAL,
  PREFIX_HKDF_FIXED,
  PREFIX_LEGACY_V3,
  PREFIX_LEGACY_V2_PROBABLY,
] as const;
const isEncrypted = (s: string): boolean => ENCRYPTED_PREFIXES.some((p) => s.startsWith(p));

// Format dispatch matching livesync-commonlib's stringEncryption.ts. Trying
// the HKDF prefixes first (current default), then the legacy AES-GCM
// formats (V2/V3). The legacy decrypt is tried with both auto-iter
// settings since the plugin used to flip that flag.
const decryptDispatch = async (encrypted: string, passphrase: string): Promise<string> => {
  if (encrypted.startsWith(PREFIX_HKDF_EPHEMERAL)) {
    return decryptWithEphemeralSalt(encrypted, passphrase);
  }
  // %= (HKDF fixed-salt) requires a salt we don't have here without
  // observing the plugin's stored sync-parameters doc; if you hit this in
  // practice, surface a DecryptionError so it shows up in logs and the
  // architecture doc gets updated.
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

const encryptDispatch = async (plain: string, passphrase: string): Promise<string> => {
  // Match the LiveSync default for new writes: HKDF ephemeral salt. Notes
  // produced this way decrypt cleanly on every supported plugin version.
  if (isEncrypted(plain)) return plain;
  return encryptWithEphemeralSalt(plain, passphrase);
};

const hexEncode = (bytes: Uint8Array): string =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

const utf8 = new TextEncoder();

/**
 * SHA-256 with key.length stretching iterations. Matches LiveSync's
 * `hashString` in src/lib/src/string_and_binary/path.ts — note that the
 * plugin's "stretching" is specifically `digest(buff)` re-hashed
 * `key.length` times, which is what we replicate.
 */
const hashString = async (key: string): Promise<string> => {
  const buff = utf8.encode(key);
  let digest = await crypto.subtle.digest("SHA-256", buff);
  for (let i = 0; i < key.length; i++) {
    digest = await crypto.subtle.digest("SHA-256", buff);
  }
  return hexEncode(new Uint8Array(digest));
};

/**
 * Convert a vault path to a CouchDB document `_id`. When obfuscation is
 * on, the body becomes a deterministic SHA-256 of
 * `${hashedPassphrase}:${path}` (preserving any `prefix:` segment from
 * the path).
 */
export const path2id = (
  path: string,
  obfuscatePassphrase: string | false,
  caseInsensitive = false,
): Effect.Effect<string, EncryptionError> =>
  Effect.tryPromise({
    try: async () => {
      let filename = caseInsensitive ? path.toLowerCase() : path;
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

/**
 * Decrypt a chunk's `data` (or a note's encrypted `path`) into plaintext.
 * Pass-through if the input doesn't carry an encryption prefix.
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

/**
 * Encrypt a string (note path or chunk body) using the LiveSync passphrase
 * and an ephemeral salt. Idempotent for already-encrypted inputs.
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

/**
 * Reassemble a note from its chunk leaves. Chunks are concatenated in the
 * order they appear in the note's `children` array.
 */
export const assembleChunks = (chunks: ReadonlyArray<string>): string => chunks.join("");

/**
 * Split a note body into chunks. The plugin uses content-defined chunking
 * for dedup; we use a simpler fixed-size split for writes since dedup
 * across the rest of the vault still works on the resulting chunk hashes
 * (the LiveSync plugin will reconverge on its preferred chunk shape on
 * the next client-side normalisation pass). Chunk size 8 KiB matches the
 * plugin's default `customChunkSize` for plain text.
 *
 * If precise chunk-format compatibility becomes important — for instance
 * because the plugin's normalisation pass is doing something we've
 * observed to break sync — switch to the `octagonal-wheels` chunker and
 * pin the chunk-splitter version, see
 * docs/obsidian-mcp/troubleshooting.md.
 */
export const splitIntoChunks = (body: string, chunkSize = 8 * 1024): string[] => {
  if (body.length <= chunkSize) return [body];
  const out: string[] = [];
  for (let i = 0; i < body.length; i += chunkSize) {
    out.push(body.slice(i, i + chunkSize));
  }
  return out;
};

/**
 * Deterministic chunk `_id` from chunk content. LiveSync derives chunk IDs
 * from a content hash so identical chunks across notes deduplicate. We use
 * SHA-256 of the (pre-encryption) content; the leading `h:` prefix is
 * required so the document is recognised as a chunk.
 */
export const chunkId = async (content: string): Promise<string> => {
  const digest = await crypto.subtle.digest("SHA-256", utf8.encode(content));
  return `${PREFIX_CHUNK}${hexEncode(new Uint8Array(digest))}`;
};
