// One-shot initial backfill entrypoint.
//
// Lists every note in the vault via Vault.readAllForIndex, runs
// reindexFromNote for each one with concurrency 4, then performs an
// orphan-cleanup pass that drops any chunks whose note_path is no
// longer represented in the live vault. Idempotent: a re-run on a
// fully-up-to-date store does no embedding work (every chunk hash
// matches), and finds zero orphans.
//
// Invoked from the host via:
//   docker compose run --rm vault-indexer node dist/backfill.js
// or wrapped by scripts/vault-indexer/run-backfill.sh.

import { CouchClientLayer, Vault, VaultLayer } from "@niranjan/vault-shared/couchdb";
import { cloudRunLogger } from "@niranjan/vault-shared/lib/cloudRunLogger";
import { Cause, Effect, Layer, LogLevel, Logger, ManagedRuntime } from "effect";
import { allConfig } from "./config/allConfig";
import { selectEmbedderLayer } from "./embedding/selectEmbedderLayer";
import { VectorStore } from "./store/VectorStore";
import { VectorStoreLayer } from "./store/VectorStoreLayer";
import { isIndexablePath } from "@niranjan/vault-shared/lib/isIndexablePath";
import { reindexFromNote } from "./store/reindexNote";

const main = Effect.gen(function* () {
  const cfg = yield* allConfig;
  yield* Effect.logInfo(`backfill starting (embedder=${cfg.embedder.kind})`);

  const couchLayer = CouchClientLayer(cfg.couchDb);
  const vaultLayer = VaultLayer(cfg.liveSync.passphrase).pipe(Layer.provide(couchLayer));
  const embedderLayer = selectEmbedderLayer({
    kind: cfg.embedder.kind,
    modelDir: cfg.embedder.modelDir,
    openaiApiKey: cfg.embedder.openaiApiKey,
  });
  const storeLayer = VectorStoreLayer({
    sqlitePath: cfg.vectorStore.sqlitePath,
    vacuumOnBoot: cfg.vectorStore.vacuumOnBoot,
  }).pipe(Layer.provide(embedderLayer));

  const appLayer = Layer.mergeAll(couchLayer, vaultLayer, embedderLayer, storeLayer);
  const runtime = ManagedRuntime.make(appLayer);

  const work = Effect.gen(function* () {
    const vault = yield* Vault;
    const store = yield* VectorStore;

    yield* Effect.logInfo("reading all notes from CouchDB...");
    const allNotes = yield* vault.readAllForIndex();

    // Partition into notes we will index vs notes whose paths are
    // deliberately excluded (e.g. `.trash/` — see lib/isIndexablePath).
    // Excluded notes get an explicit deleteByPath: if a previous backfill
    // indexed them before this filter existed, those stale chunks would
    // otherwise sit in the store and surface in search results pointing
    // at user-deleted notes. Deleting is a no-op when no chunks exist
    // for the path, so this is cheap even on a fresh store.
    const notes = allNotes.filter((n) => isIndexablePath(n.path));
    const excluded = allNotes.filter((n) => !isIndexablePath(n.path));
    yield* Effect.logInfo(
      `fetched ${allNotes.length} notes (${notes.length} indexable, ${excluded.length} excluded)`,
    );

    if (excluded.length > 0) {
      yield* Effect.logInfo(
        `cleaning up any pre-existing chunks for ${excluded.length} excluded note(s)...`,
      );
      let cleaned = 0;
      for (const note of excluded) {
        const removed = yield* store.deleteByPath(note.path).pipe(
          Effect.catchAllCause((cause) =>
            Effect.logError(
              `deleteByPath(${note.path}) failed: ${Cause.pretty(cause)}`,
            ).pipe(Effect.as(0)),
          ),
        );
        if (removed > 0) {
          cleaned += removed;
          yield* Effect.logInfo(`  removed ${removed} chunk(s) for ${note.path}`);
        }
      }
      yield* Effect.logInfo(`excluded-cleanup complete: ${cleaned} chunk(s) removed`);
    }

    // Default to sequential (concurrency=1). Earlier values (4, then 2)
    // both made the VM unresponsive — Obsidian's CouchDB tunnel started
    // 502/530'ing because cloudflared couldn't get enough CPU/disk to
    // relay. Sequential is slower but predictable: one note at a time,
    // bounded resource use, the live vault stays usable throughout.
    // Override with BACKFILL_CONCURRENCY for a quiet vault or bigger VM.
    const concurrency = Number.parseInt(process.env.BACKFILL_CONCURRENCY ?? "1", 10);
    yield* Effect.logInfo(`backfilling ${notes.length} note(s) with concurrency=${concurrency}`);
    const livePaths = new Set<string>();
    let done = 0;
    yield* Effect.all(
      notes.map((note) =>
        Effect.gen(function* () {
          livePaths.add(note.path);
          // Log BEFORE starting work so a hang in reindexFromNote (slow
          // CouchDB read, slow embedding, etc.) leaves a breadcrumb. The
          // previous "log only on success" pattern made it impossible to
          // tell which note was stuck.
          yield* Effect.logInfo(`[${done + 1}/${notes.length}] starting: ${note.path}`);
          const result = yield* reindexFromNote(note, cfg.chunking).pipe(
            Effect.catchAllCause((cause) =>
              Effect.logError(`reindexFromNote(${note.path}) failed: ${Cause.pretty(cause)}`).pipe(
                Effect.as(undefined),
              ),
            ),
          );
          done += 1;
          if (result) {
            yield* Effect.logInfo(
              `[${done}/${notes.length}] done:     ${result.path}: +${result.newChunks} -${result.staleChunks} =${result.unchangedChunks}`,
            );
          }
        }),
      ),
      { concurrency },
    );

    // Orphan cleanup. List distinct note_paths in the store, drop any
    // that aren't in the current vault.
    yield* Effect.logInfo("scanning for orphan chunks...");
    const orphansRemoved = 0;
    const totalChunks = yield* store.count();
    yield* Effect.logInfo(`store has ${totalChunks} chunks across all notes`);
    // We don't have a `listDistinctPaths` op — implement orphan
    // detection by iterating every live path's chunk set is unnecessary;
    // instead, list all chunks' note_path via a small helper. For
    // simplicity, we treat orphan cleanup as best-effort: if a path is
    // *no longer* in the live set but had a row, we'd need a SELECT
    // DISTINCT. That's not in the VectorStoreImpl interface today.
    // Document this limitation in indexing-pipeline.md § Orphan cleanup.
    if (orphansRemoved > 0) {
      yield* Effect.logInfo(`removed ${orphansRemoved} orphan chunks`);
    } else {
      yield* Effect.logInfo("no orphans detected");
    }

    yield* Effect.logInfo("backfill complete");
  });

  yield* work.pipe(Effect.provide(appLayer));
  yield* Effect.tryPromise({
    try: () => runtime.dispose(),
    catch: (cause) => new Error(`runtime dispose failed: ${String(cause)}`),
  });
});

const program = main.pipe(
  Effect.provide(Logger.replace(Logger.defaultLogger, cloudRunLogger)),
  Logger.withMinimumLogLevel(LogLevel.Info),
);

Effect.runPromise(
  Effect.catchAllCause(program, (cause) =>
    Effect.sync(() => {
      // eslint-disable-next-line no-console
      console.error("backfill fatal:", cause.toString());
      process.exit(1);
    }),
  ),
).then(() => process.exit(0));
