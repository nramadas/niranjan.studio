// Barrel: the transcript-digest module — the Claude-backed digest client,
// the vault-apply orchestration, and the deterministic dossier merge.
// Module-level types and the errors sub-module are namespaced per the
// styleguide.

export * from "./applyDigest";
export * from "./DigestClient";
export * from "./DigestClientLayer";
export * from "./mergeDossier";
export * as errors from "./errors";
export * as types from "./types.ts";
