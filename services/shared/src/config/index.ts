// Barrel for shared Effect Config modules. Holds only the two configs
// both services (obsidian-mcp and vault-indexer) need: CouchDB connection
// and LiveSync passphrase. Service-specific configs (OAuth, search
// debounce, embedder, etc.) live inside the service that owns them.

export * from "./couchDbConfig";
export * from "./liveSyncConfig";
