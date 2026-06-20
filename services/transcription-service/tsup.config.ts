import { defineConfig } from "tsup";

// Production build. Mirrors services/obsidian-mcp/tsup.config.ts: tsup
// (esbuild) resolves folder imports and `.ts` specifiers, emits one ESM
// bundle, and keeps npm deps external. `tsc` only typechecks.
//
// @niranjan/vault-shared is force-bundled because it lives only at build
// time — its runtime resolution would be a dangling symlink in the
// container image. Only the shared logger is pulled in here (no CouchDB,
// no E2EE codec), so the bundle stays small.

export default defineConfig({
  entry: ["src/main.ts"],
  format: ["esm"],
  target: "node22",
  outDir: "dist",
  splitting: false,
  sourcemap: true,
  clean: true,
  bundle: true,
  minify: false,
  external: [/^node:/, "effect", "nano", "octagonal-wheels", "zod"],
  noExternal: ["@niranjan/vault-shared"],
});
