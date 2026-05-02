import { PREFIX_CHUNK } from "../constants.ts";

const utf8 = new TextEncoder();

const hexEncode = (bytes: Uint8Array): string =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

/**
 * Derive a deterministic CouchDB document id for a chunk's plaintext
 * content. LiveSync uses a content hash so identical chunks across notes
 * deduplicate; we mirror that by using SHA-256 over the pre-encryption
 * content. The leading `h:` prefix is required so the document is
 * recognised as a chunk by LiveSync clients.
 */
export const chunkId = async (content: string): Promise<string> => {
  const digest = await crypto.subtle.digest("SHA-256", utf8.encode(content));
  return `${PREFIX_CHUNK}${hexEncode(new Uint8Array(digest))}`;
};
