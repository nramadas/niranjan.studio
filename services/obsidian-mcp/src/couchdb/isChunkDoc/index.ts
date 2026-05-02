import type { ChunkDoc } from "../types.ts";

/**
 * Type guard: narrows an arbitrary CouchDB document to a ChunkDoc (a
 * "leaf" in LiveSync terminology). The `_id` will start with `h:`, but
 * we discriminate on `type` because the `_id` prefix isn't enough — some
 * `h:`-prefixed legacy entries are not chunks.
 */
export const isChunkDoc = (d: { type?: string }): d is ChunkDoc => d.type === "leaf";
