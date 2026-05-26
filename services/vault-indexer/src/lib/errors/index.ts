// Barrel: tagged errors local to the indexer service. Cross-service
// errors (CouchDbError, DecryptionError, etc.) live in
// @niranjan/vault-shared/lib/errors.

export * from "./EmbeddingError";
export * from "./VectorStoreError";
export * from "./VectorStoreSchemaError";
