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
});
