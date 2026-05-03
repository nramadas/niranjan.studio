import { PREFIX_CHUNK, PREFIX_ENCRYPTED_CHUNK } from "../constants.ts";

const utf8 = new TextEncoder();

const hexEncode = (bytes: Uint8Array): string =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

/**
 * Derive a deterministic CouchDB document id for a chunk's plaintext
 * content. LiveSync uses a content hash so identical chunks across notes
 * deduplicate; we mirror that by using SHA-256 over the pre-encryption
 * content.
 *
 * The prefix is load-bearing: `h:+` marks the chunk as encrypted so the
 * plugin's `isEncryptedChunkEntry` gate fires and runs HKDF decryption
 * on read. Plain `h:` makes the plugin treat the chunk's `data` field
 * as plaintext, which would paste our HKDF ciphertext into notes as
 * literal text. Always pass `encrypted: true` when the chunk's `data`
 * will be HKDF-encrypted before storage.
 *
 * Note on the hash: the plugin uses xxhash64 by default and our SHA-256
 * won't dedup against plugin-written chunks. That's a write-side
 * inefficiency only; on read, the plugin trusts the `children` list
 * and fetches by id without re-verifying the hash.
 */
export const chunkId = async (content: string, encrypted: boolean): Promise<string> => {
  const digest = await crypto.subtle.digest("SHA-256", utf8.encode(content));
  const prefix = encrypted ? PREFIX_ENCRYPTED_CHUNK : PREFIX_CHUNK;
  return `${prefix}${hexEncode(new Uint8Array(digest))}`;
};
