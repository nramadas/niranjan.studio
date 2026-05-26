// Barrel: re-exports each function/class folder. Module-level types and
// the schema file are namespaced/asset references — the schema is read
// at runtime by `openVectorStore` and is not a TS export.

export * from "./diffChunks";
export * from "./openVectorStore";
export { reindexFromNote, reindexNoteById } from "./reindexNote";
export type { ReindexResult } from "./reindexNote";
export * from "./VectorStore";
export * from "./VectorStoreLayer";
export * as types from "./types.ts";
