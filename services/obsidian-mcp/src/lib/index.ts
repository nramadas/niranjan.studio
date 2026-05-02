// Barrel: re-exports the public surface of each child folder. The errors
// sub-module is namespaced under `errors` (per the styleguide rule for
// nested modules) — consumers reach a tagged error class via
// `errors.AuthError`, never as a flat top-level export of `lib`.

export * from "./cloudRunLogger";
export * as errors from "./errors";
