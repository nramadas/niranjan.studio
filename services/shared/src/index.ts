// Top-level barrel for @niranjan/vault-shared.
//
// Consumers normally import from a specific sub-path
// (`@niranjan/vault-shared/couchdb`, `@niranjan/vault-shared/lib`,
// `@niranjan/vault-shared/config`) per the styleguide and the package's
// `exports` map. This file exists so a single `import * from
// "@niranjan/vault-shared"` is also possible for tooling that doesn't
// resolve subpaths.

export * as couchdb from "./couchdb";
export * as lib from "./lib";
export * as config from "./config";
