import { defineConfig } from "tsup";

// Bundle three entrypoints into the same dist tree:
//   - main.ts     — the long-running service: changes subscriber + /search
//   - backfill.ts — one-shot initial backfill (run via `docker compose run`)
//   - eval.ts     — evaluation harness (run by scripts/vault-indexer/evaluate.sh)
//
// All three share the workspace shared package, the embedder/chunker/store
// stacks, and the same config. tsup emits them as separate files so the
// container CMD or `docker compose run` can pick which one to execute.
//
// Externals are libraries that ship a native binary (.node or .so) we
// cannot bundle into a single JS file; they have to remain in
// node_modules and be `require`d at runtime. onnxruntime-node and
// better-sqlite3 have prebuilt platform binaries; sharp is a transitive
// dep of @huggingface/transformers (image pipelines we don't use); the
// sqlite-vec platform packages ship the loadable extension binary.

export default defineConfig({
  entry: ["src/main.ts", "src/backfill.ts", "src/eval.ts"],
  format: ["esm"],
  target: "node22",
  platform: "node",
  outDir: "dist",
  sourcemap: true,
  splitting: false,
  clean: true,
  bundle: true,
  external: [
    "onnxruntime-node",
    "sharp",
    "better-sqlite3",
    "sqlite-vec",
    "sqlite-vec-darwin-arm64",
    "sqlite-vec-darwin-x64",
    "sqlite-vec-linux-arm64",
    "sqlite-vec-linux-x64",
  ],
  // Force-bundle the workspace package. tsup auto-externalizes anything
  // in `dependencies`, but @niranjan/vault-shared lives only at build
  // time — its runtime resolution would be a dangling symlink in the
  // container image (services/shared is outside the copied node_modules
  // tree). Bundling it into dist/main.js sidesteps that entirely.
  noExternal: ["@niranjan/vault-shared"],
});
