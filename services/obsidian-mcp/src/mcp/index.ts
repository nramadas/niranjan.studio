// Barrel: re-exports the public surface of each child folder. The
// `tools` sub-module is namespaced (per the styleguide rule for nested
// modules) — consumers reach a tool factory via `tools.listNotes`, never
// as a flat top-level export of `mcp`.

export * from "./buildMcpServer";
export * from "./runTool";
export * as types from "./types.ts";
export * as tools from "./tools";
