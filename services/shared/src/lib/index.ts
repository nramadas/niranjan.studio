// Barrel for the shared lib module. Mirrors the styleguide's nested
// sub-module convention from services/obsidian-mcp/src/lib/index.ts —
// cloudRunLogger is a flat re-export (it's a class-like value); errors is
// a namespaced sub-module so consumers reach a tagged error via
// `errors.AuthError`.

export * from "./cloudRunLogger";
export * as errors from "./errors";
