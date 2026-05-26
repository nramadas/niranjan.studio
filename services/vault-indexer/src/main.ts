// Long-running entrypoint for the vault-indexer.
//
// Boot order:
//   1. Resolve config from env (fails fast on missing vars).
//   2. Build the layer graph: CouchClient → Vault → Embedder → VectorStore → ChangesQueue.
//   3. Subscribe to CouchDB's `_changes` feed; route each event through
//      processChangeEvent and into the queue.
//   4. Start the HTTP server (/health, /search).
//   5. Install SIGTERM/SIGINT handlers that drain the queue, close the
//      SQLite handle, then exit.
//
// The HTTP layer is intentionally thin (raw node:http). Effect drives
// everything inside the request lifecycle. Same shape as Phase 2's
// obsidian-mcp main.ts — only the layer set differs.

import {
  CouchClient,
  CouchClientLayer,
  VaultLayer,
  subscribeChanges,
} from "@niranjan/vault-shared/couchdb";
import { cloudRunLogger } from "@niranjan/vault-shared/lib/cloudRunLogger";
import { Cause, Effect, Layer, LogLevel, Logger, ManagedRuntime } from "effect";
import { ChangesQueue } from "./changes/ChangesQueue";
import { ChangesQueueLayer } from "./changes/ChangesQueueLayer";
import { processChangeEvent } from "./changes/processChangeEvent";
import { allConfig } from "./config/allConfig";
import { selectEmbedderLayer } from "./embedding/selectEmbedderLayer";
import { buildHttpServer } from "./http/buildHttpServer";
import { VectorStore } from "./store/VectorStore";
import { VectorStoreLayer } from "./store/VectorStoreLayer";

const main = Effect.gen(function* () {
  const cfg = yield* allConfig;
  yield* Effect.logInfo(
    `booting vault-indexer on ${cfg.server.bindAddr}:${cfg.server.port} (embedder=${cfg.embedder.kind})`,
  );

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

  const queueLayer = ChangesQueueLayer({
    debounceMs: cfg.changes.debounceMs,
    chunking: cfg.chunking,
  }).pipe(Layer.provide(Layer.mergeAll(vaultLayer, embedderLayer, storeLayer)));

  const appLayer = Layer.mergeAll(couchLayer, vaultLayer, embedderLayer, storeLayer, queueLayer);

  const runtime = ManagedRuntime.make(appLayer);

  // Resolve services we need synchronously below.
  const couch = yield* CouchClient.pipe(Effect.provide(couchLayer));
  const queue = yield* ChangesQueue.pipe(Effect.provide(appLayer));

  // Subscribe to _changes and route into the queue. The shared
  // subscribeChanges takes a plain callback (not an Effect) — we marshal
  // the side-effecting enqueue back through the runtime so Effect's
  // logger and supervision still apply.
  yield* subscribeChanges(couch.raw(), (event) => {
    void runtime.runPromise(
      Effect.gen(function* () {
        const action = yield* processChangeEvent(event);
        switch (action.kind) {
          case "reindex":
            yield* queue.enqueueReindex(action.docId);
            return;
          case "delete":
            yield* queue.enqueueDelete(action.docId);
            return;
          case "skip":
            return;
        }
      }).pipe(
        Effect.catchAllCause((cause) =>
          Effect.logError(`change-event handler failed: ${Cause.pretty(cause)}`),
        ),
      ),
    );
  });

  // Start the HTTP server. It uses the runtime to execute the search effect.
  const { listen, close } = buildHttpServer(
    {
      port: cfg.server.port,
      bindAddr: cfg.server.bindAddr,
      bearer: cfg.searchToken.bearer,
    },
    runtime as never,
  );
  yield* Effect.tryPromise({
    try: () => listen(),
    catch: (cause) => new Error(`HTTP server failed to listen: ${String(cause)}`),
  });
  yield* Effect.logInfo(`listening on ${cfg.server.bindAddr}:${cfg.server.port}`);

  // SIGTERM / SIGINT: drain the queue, close the server, close the
  // SQLite handle, then exit. Cloud-style supervisors send SIGTERM with
  // a configurable grace period (docker compose: 10 s by default); the
  // drain step honours that by attempting to land work that's already
  // in flight rather than starting new work.
  const shutdown = (signal: string) =>
    runtime
      .runPromise(
        Effect.gen(function* () {
          yield* Effect.logInfo(`received ${signal}; draining...`);
          yield* queue.drain();
          yield* (yield* VectorStore).close();
        }),
      )
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.error(`shutdown error: ${String(err)}`);
      })
      .then(() => close())
      .then(() => process.exit(0));

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  yield* Effect.never;
});

const program = main.pipe(
  Effect.provide(Logger.replace(Logger.defaultLogger, cloudRunLogger)),
  Logger.withMinimumLogLevel(LogLevel.Info),
);

Effect.runPromise(
  Effect.catchAllCause(program, (cause) =>
    Effect.sync(() => {
      // eslint-disable-next-line no-console
      console.error("fatal:", cause.toString());
      process.exit(1);
    }),
  ),
).then(() => {
  process.exit(0);
});
