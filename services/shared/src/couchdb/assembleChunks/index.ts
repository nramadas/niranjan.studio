/**
 * Reassemble a note body from its decrypted chunk leaves. Chunks are
 * concatenated in the order they appear in the note's `children` array;
 * the caller is responsible for putting them in that order before calling.
 */
export const assembleChunks = (chunks: ReadonlyArray<string>): string => chunks.join("");
