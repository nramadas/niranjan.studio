# Code style guide

This document is the canonical reference for how code in `services/obsidian-mcp/` is structured. An AI agent (or human) generating new code in this service should follow it strictly. Deviating means later refactoring work — both cosmetic (move and split) and substantive (de-tangle imports, extract tests).

The rules below are intentionally narrow and prescriptive. They optimise for one thing: every function is independently navigable, independently testable, and easy to relocate without dragging unrelated code along with it.

## 1. One public function per file

Each `.ts` file exports exactly one public function. If you have a second function that "feels related," it goes in its own file — even if that file is two lines long. Co-located helpers that are not exported are fine, but the moment a helper becomes useful to another caller, it earns its own file.

This rule is unintuitive when you're writing a small utility module and three functions naturally cluster. Resist the urge to bundle them. The cost of an extra file is near-zero; the cost of a file that grows from "small cluster of related helpers" into "hundred-line grab bag" is paid every time someone reads, edits, or moves it.

Concretely:

- A file that defines a private helper used only by the file's public function is fine. The helper is not exported.
- A file that defines two public functions, even closely related ones (`encryptField` and `decryptField`), is **not** fine. They are two files.
- Type definitions, constants, and interfaces that exist only to support a single function may live alongside it. If they are reused, they get their own file (and folder, per rule 3).

## 2. Each function carries a docstring

The exported function has a JSDoc block immediately above its declaration. The docstring states:

- **What the function does**, in one sentence.
- **What its inputs mean** (when not obvious from the type), with `@param` lines.
- **What it returns**, with a `@returns` line.
- **What it throws or fails with** (for Effect-returning functions, the tagged error type), with a `@throws` or note in the description.

Skip narrating mechanics that are obvious from reading the body. Do explain non-obvious *why*: a constraint from an upstream library, a workaround for a known bug, a deliberate choice that would surprise a reader.

Example:

```ts
/**
 * Decrypt a chunk's `data` field (or a note's encrypted `path`) into plaintext.
 * Pass-through when the input doesn't carry an encryption prefix — LiveSync
 * stores plaintext-equivalent fields without re-encrypting them, so the
 * dispatch needs to handle both shapes.
 *
 * @param field      The raw field value as stored in CouchDB.
 * @param passphrase The LiveSync E2EE passphrase.
 * @param docId      The document _id, used in the error payload for debugging.
 * @returns          An Effect that yields the plaintext string.
 *                   Fails with DecryptionError if the format is unrecognised
 *                   or the passphrase is wrong.
 */
export const decryptField = (...) => ...;
```

For internal helpers (not exported), a one-line `//` comment is enough — full docstrings are reserved for the public boundary.

## 3. Each function lives in a folder named after it, in `index.ts`

The folder name **mirrors the case of the export**. A function exported as `decryptField` (camelCase) lives in a folder named `decryptField`. A class exported as `CouchClient` (UpperCamelCase) lives in a folder named `CouchClient`. The case of the folder is a syntactic signal of what kind of thing it exports — you can tell at a glance from the directory listing whether you're looking at a function, a class, or a module.

The file structure for a function `decryptField` is:

```
src/couchdb/decryptField/
├── index.ts          # exports decryptField
└── index.test.ts     # tests decryptField
```

For a class `CouchClient`:

```
src/couchdb/CouchClient/
├── index.ts          # exports CouchClient
└── index.test.ts     # tests CouchClient
```

Imports come from the folder, not the file (see the "Imports" section below for the full rules):

```ts
import { decryptField } from "../couchdb/decryptField";
```

Folders contain **only** the index file, the test file, and any private helper files that are not exported (if they grow large enough to warrant their own file, they get their own folder per rule 1).

Why the folder, not just `decryptField.ts`? Because rule 4 requires a co-located test file, and rule 1 forbids stuffing tests into the same file as the implementation. The folder is the unit that holds both. It's also the unit you move when you relocate the function: `git mv` the folder, update the import paths, done.

### Nested folder grouping is encouraged

Module folders can contain other module folders. When a set of related exports inside a module starts to outweigh the rest of the module, group them into a sub-folder rather than letting the parent's directory listing balloon.

Example: this codebase has eight tagged error classes. They were originally siblings of `cloudRunLogger/` directly under `src/lib/`. That made `src/lib/` a wall of error folders interrupted by one logger. They are now grouped under `src/lib/errors/`:

```
src/lib/
├── cloudRunLogger/
├── errors/
│   ├── AuthError/
│   ├── ChangesFeedError/
│   ├── CouchDbError/
│   ├── DecryptionError/
│   ├── EncryptionError/
│   ├── NoteConflictError/
│   ├── NoteNotFoundError/
│   ├── ValidationError/
│   └── index.ts          ← barrel for the errors sub-module
└── index.ts              ← `lib` barrel; re-exports `./errors` and `./cloudRunLogger`
```

The grouping criterion is "would a reader see this and want to scan it as a unit?" For tagged errors, yes — they share a shape (`Data.TaggedError(...)`), they're often imported together, and they're a natural conceptual group. The cost of one extra folder level is paid for by a parent directory listing that reads cleanly.

Don't over-nest: a single error or two doesn't need its own folder. The threshold is roughly five-plus related items, OR a clear conceptual boundary that a reader would benefit from seeing as a group. When in doubt, leave them flat — promotion is cheap.

### Module folders use kebab-case

The export-mirroring rule has one exception. A folder whose purpose is to **group other exports** — i.e. it contains other folders, not source code of its own — is named in kebab-case. Examples: `src/couchdb/`, `src/mcp/tools/`, `src/auth/`. These folders don't export anything that has a "case" of its own; they exist to namespace the exports inside them.

The visual rule is: if a folder's children are all themselves folders (or barrel-exports of folders), it's a module folder and its name is kebab-case. If a folder's children include `index.ts` and `index.test.ts` directly, it is a function/class folder and its name mirrors the export.

### Module folders contain a barrel `index.ts`

A module folder contains an `index.ts` whose only job is to re-export the public surface of every child folder it contains. This lets consumers import from the module rather than from individual child folders.

There are three re-export shapes, and which one you use depends on what the child is:

1. **Function/class folders → flat re-export.** Use `export * from './childFolder'`. Named-export lists (`export { foo } from "./foo"`) are not used — they bit-rot when a child folder gains a new export, and the maintenance cost over a year is real. With `export *`, adding a new function to the module is a one-line barrel update.

2. **Module-level `types.ts` and `constants.ts` → namespaced re-export.** Use `export * as types from './types.ts'` and `export * as constants from './constants.ts'`. This keeps the module's flat exports a list of *functions and classes*, with type definitions accessed via `types.Foo` and constants via `constants.PREFIX_CHUNK`. Autocomplete on `import { … } from "./couchdb"` shows you only callable things, and reading a consumer's import line tells you immediately whether you're pulling in code or a type.

3. **Nested sub-module folders → namespaced re-export, named after the folder.** Use `export * as <folderName> from './<folderName>'`. So `lib/errors/` is re-exported from `lib/index.ts` as `export * as errors from "./errors";`, and `mcp/tools/` is re-exported from `mcp/index.ts` as `export * as tools from "./tools";`. Consumers reach `errors.AuthError` and `tools.listNotes`. Same reasoning as types/constants — namespacing the sub-module keeps the parent's flat exports focused on the parent's *own* functions/classes, with related collections accessible under a clear handle. It also avoids name collisions when two sibling sub-modules might export the same name.

```ts
// src/couchdb/index.ts — module barrel with all three forms
export * from "./decryptField";        // function folder → flat
export * from "./encryptField";
export * from "./CouchClient";         // class folder → flat
export * from "./path2id";
// ...other function/class folders...
export * as types from "./types.ts";       // module-level types → namespaced
export * as constants from "./constants.ts"; // module-level constants → namespaced
```

```ts
// src/lib/index.ts — barrel with a nested sub-module
export * from "./cloudRunLogger";        // function folder → flat
export * as errors from "./errors";       // sub-module folder → namespaced
```

```ts
// src/mcp/index.ts — barrel with a nested sub-module + types
export * from "./buildMcpServer";
export * from "./runTool";
export * as types from "./types.ts";
export * as tools from "./tools";        // sub-module folder → namespaced
```

```ts
// consumer of lib
import { cloudRunLogger, errors } from "../lib";
throw new errors.AuthError({ reason: "missing header", statusCode: 401 });
```

```ts
// consumer of mcp
import { buildMcpServer, tools, types } from "../mcp";
const server = buildMcpServer(runtime);
const myTool = tools.listNotes(runtime);
type Result = types.ToolResult;
```

Barrel files contain no logic — only re-exports. They don't get a `.test.ts` (there's nothing to test). When a new function-folder is added inside a module, the module's barrel is updated in the same change. With `export *`, that update is one line.

The nested sub-module's *own* barrel (`src/lib/errors/index.ts`, `src/mcp/tools/index.ts`) follows the function/class rule for its own children — flat `export *`. The namespacing happens once, at the parent that re-exports the sub-module.

#### Internal imports stay direct

The barrel-based imports are for *consumers* of a module. **Code inside the same module imports its dependencies directly** — `from "../types.ts"` for the module's shared types, `from "../sibling-function"` for a sibling function-folder. Going through the parent barrel from a sibling would produce circular import warnings and would force the namespaced (`types.Foo`) form for type access at the cost of readability. Reserve the barrel for crossing module boundaries.

## Imports

Two rules:

1. **A folder import resolves to that folder's `index.ts`.** Write `from "./decryptField"`, not `from "./decryptField/index.ts"` and not `from "./decryptField/index.js"`. Both the explicit forms work but read as boilerplate; the folder import is the canonical style and matches how the barrels themselves re-export.
2. **A direct file import uses the source extension `.ts`** (or `.tsx` etc., for whatever the file actually is). Write `from "../types.ts"`, not `from "../types.js"`. Imports name source files; the build pipeline resolves them.

```ts
// good
import { decryptField } from "../decryptField";
import type { NoteDoc } from "../types.ts";

// bad — verbose, leaks the resolution mechanism
import { decryptField } from "../decryptField/index.ts";
import { decryptField } from "../decryptField/index.js";

// bad — `.js` is the emit extension, not the source extension
import type { NoteDoc } from "../types.js";
```

These rules require:

- **`tsconfig.json`** with `"moduleResolution": "Bundler"`, `"module": "Preserve"`, `"allowImportingTsExtensions": true`, and `"noEmit": true`. tsc only typechecks; it never emits the runtime artefact.
- **A bundler for production builds.** This service uses [tsup](https://tsup.egoist.dev/) (a thin wrapper around esbuild) configured in `tsup.config.ts` to produce a single bundled `dist/main.js`. `npm run build` invokes it. Vite, esbuild directly, swc, or any other Node-targeting bundler is also fine — the requirement is "something that resolves bundler-style imports."
- **A TS-aware dev runner.** Both `tsx` (used here) and Vite/Vitest natively understand folder imports and `.ts` extensions, so `npm run dev` and `npm test` need no extra config.

The reason the runtime can't be plain `node dist/main.js` of tsc-emitted output: Node's CommonJS/ESM resolvers don't do folder imports (no implicit `index.js` lookup) and don't know about `.ts` source files. The bundler bridges that gap by inlining everything into one entry that has only fully-resolved JS dependencies left.

## 4. Each function-folder also contains a test file

Beside `index.ts`, there is `index.test.ts` (or whatever the test framework's naming convention is — Vitest and Jest both accept `.test.ts`).

The test file imports the function from `./index.ts` and exercises it. Tests do not reach across function-folders. If a test needs a helper from a sibling function-folder, that helper is being treated as a public dependency — re-import it via its public path, don't dig into its internals.

A function-folder without a test file is incomplete. New code lands with its tests; tests are not a follow-up. If the function is genuinely untestable in isolation (it's a thin wrapper over a third-party library), the test file still exists and contains a single test asserting the wrapper's contract — `expect(typeof fn).toBe("function")` is not enough; assert behaviour through a stub.

## 5. Tests are co-located with their function and only their function

A test file tests **only** the function in its own folder. It does not test sibling functions, even when the test would be convenient to write in a shared file. If you find yourself wanting to test `encryptField` and `decryptField` round-trip behaviour in one test, the round-trip test belongs to a third function (e.g. an `assertRoundTrip` helper, or an integration test inside a `tests/` folder at a higher level) — not to either of the two functions individually.

Concretely, a test in `src/couchdb/decryptField/index.test.ts`:

- Imports `decryptField` from `./index.ts` (per the Imports section above).
- Imports test fixtures from a shared location, not from sibling function-folders.
- May stub or mock dependencies, but does not directly invoke other public functions to set up state. If setup is complex, factor the setup into a fixture file.

This rule prevents the slow drift where a test file accumulates assertions for "all the chunk-related stuff" and becomes the only place where a particular code path is exercised. When the function moves or is deleted, its tests move or are deleted with it.

## Why these rules

The five rules above compose into a single property: **a function and its tests are an atomic unit**. You can move it, delete it, or replace it without untangling shared state in either source or test files. You can find any function by name (the folder name) and read its full surface (one file, one docstring, one test file) without scanning a 500-line module.

The cost is more files and more directories. That cost is real but small. The benefit — every refactor is a folder-level operation, every grep for a function name lands in exactly one place — accrues every day for the life of the codebase.
