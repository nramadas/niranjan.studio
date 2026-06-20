// Barrel: re-exports the public surface of each child folder. There used
// to be a module-level `types.ts` for the AuthProvider discriminator, but
// with a single OAuth provider in production there's nothing left to put
// there.

export * from "./allConfig";
export * from "./allowedEmailsConfig";
export * from "@niranjan/vault-shared/config/couchDbConfig";
export * from "./googleOidcConfig";
export * from "./indexerConfig";
export * from "@niranjan/vault-shared/config/liveSyncConfig";
export * from "./oauthConfig";
export * from "./recallConfig";
export * from "./searchConfig";
export * from "./serverConfig";
export * from "./transcriptionConfig";
