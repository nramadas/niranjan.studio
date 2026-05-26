import { defineConfig } from "tsup";

// Production build. tsup wraps esbuild and handles:
//   - Folder imports (e.g. `from "./foo"` resolving to `./foo/index.ts`).
//   - `.ts` extensions in import specifiers.
//   - ESM emit targeted at modern Node.
//
// `tsc` is used only for typechecking (see `npm run typecheck`); emitting
// the runtime artefact is tsup's job.
//
// Externalises everything in node_modules by default — production
// `npm ci --omit=dev` still trims devDependencies, and the resulting
// dist/main.js is a thin entry that imports its npm deps at runtime.

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
  // node:* and npm package imports stay external. Only our `src/` is bundled.
  external: [/^node:/, /^@modelcontextprotocol\//, "effect", "jose", "nano", "octagonal-wheels", "zod"],
  // Force-bundle the workspace package. tsup auto-externalizes anything
  // in `dependencies`, but @niranjan/vault-shared lives only at build
  // time — its runtime resolution would be a dangling symlink in the
  // container image (services/shared is outside the copied node_modules
  // tree). Bundling it into dist/main.js sidesteps that entirely.
  noExternal: ["@niranjan/vault-shared"],
});
