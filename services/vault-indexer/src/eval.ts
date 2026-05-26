// Evaluation harness entrypoint.
//
// Runs a fixed query set against the vault index under two different
// embedder configurations and prints results side-by-side for human
// judgment. Used by scripts/vault-indexer/evaluate.sh.
//
// Approach: side-stores. Each model gets its own SQLite file
// (`/var/lib/vault-indexer/eval-${model}.db`), populated by a one-shot
// backfill under that model's embedder layer. The harness never touches
// the prod store. After eval, the side-stores can be removed.
//
// CLI flags via process.env:
//   EVAL_MODELS         — comma-separated list of "bge-small" / "openai-small" / "openai-large"
//   EVAL_QUERIES_FILE   — path to a newline-separated query list
//                         (default: /opt/vault-indexer/eval/queries.txt)
//   EVAL_TOP_K          — hits per query (default 5)
//
// The harness writes one block per query, with each model's hits in a
// neighbouring column. Humans read it; no automated scoring.

import { readFileSync } from "node:fs";
import { CouchClientLayer, Vault, VaultLayer } from "@niranjan/vault-shared/couchdb";
import { cloudRunLogger } from "@niranjan/vault-shared/lib/cloudRunLogger";
import { Cause, Effect, Layer, LogLevel, Logger, ManagedRuntime, Option, Redacted } from "effect";
import { allConfig } from "./config/allConfig";
import { selectEmbedderLayer } from "./embedding/selectEmbedderLayer";
import { semanticSearch } from "./search/semanticSearch";
import { VectorStoreLayer } from "./store/VectorStoreLayer";
import { reindexFromNote } from "./store/reindexNote";

interface ModelChoice {
  readonly kind: "bge-small" | "openai-small" | "openai-large";
}

const parseModels = (envValue: string | undefined): ModelChoice[] => {
  const raw = (envValue ?? "bge-small,openai-small").split(",").map((s) => s.trim());
  return raw.map((kind) => {
    if (kind !== "bge-small" && kind !== "openai-small" && kind !== "openai-large") {
      throw new Error(`unknown model: ${kind}`);
    }
    return { kind };
  });
};

const readQueries = (path: string): string[] =>
  readFileSync(path, "utf8")
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !s.startsWith("#"));

const main = Effect.gen(function* () {
  const cfg = yield* allConfig;

  const queriesPath = process.env.EVAL_QUERIES_FILE ?? "/opt/vault-indexer/eval/queries.txt";
  const topK = Number(process.env.EVAL_TOP_K ?? "5");
  const models = parseModels(process.env.EVAL_MODELS);
  const queries = readQueries(queriesPath);

  yield* Effect.logInfo(`eval: ${queries.length} queries × ${models.length} models, top-K=${topK}`);
  yield* Effect.logInfo(`models: ${models.map((m) => m.kind).join(", ")}`);

  const couchLayer = CouchClientLayer(cfg.couchDb);
  const vaultLayer = VaultLayer(cfg.liveSync.passphrase).pipe(Layer.provide(couchLayer));

  // One side-store per model. Each gets its own backfill, then its own query pass.
  const perModelResults = new Map<string, Map<string, ReadonlyArray<EvalHit>>>();

  for (const model of models) {
    const sidePath = `${cfg.vectorStore.sqlitePath}.eval-${model.kind}.db`;
    yield* Effect.logInfo(`--- model=${model.kind} sideStore=${sidePath}`);

    const openaiKey: Option.Option<Redacted.Redacted<string>> =
      model.kind === "bge-small" ? Option.none() : cfg.embedder.openaiApiKey;
    const embedderLayer = selectEmbedderLayer({
      kind: model.kind,
      modelDir: cfg.embedder.modelDir,
      openaiApiKey: openaiKey,
    });
    const storeLayer = VectorStoreLayer({
      sqlitePath: sidePath,
      vacuumOnBoot: false,
    }).pipe(Layer.provide(embedderLayer));
    const appLayer = Layer.mergeAll(couchLayer, vaultLayer, embedderLayer, storeLayer);
    const runtime = ManagedRuntime.make(appLayer);

    // Backfill phase.
    const backfill = Effect.gen(function* () {
      const vault = yield* Vault;
      const notes = yield* vault.readAllForIndex();
      yield* Effect.logInfo(`backfilling side-store: ${notes.length} notes`);
      yield* Effect.all(
        notes.map((note) =>
          reindexFromNote(note, cfg.chunking).pipe(
            Effect.catchAllCause((cause) =>
              Effect.logError(`eval reindex(${note.path}): ${Cause.pretty(cause)}`).pipe(
                Effect.as(undefined),
              ),
            ),
          ),
        ),
        { concurrency: 4 },
      );
    });

    yield* backfill.pipe(Effect.provide(appLayer));

    // Query phase.
    const modelResults = new Map<string, ReadonlyArray<EvalHit>>();
    for (const q of queries) {
      const hits = yield* semanticSearch(q, topK).pipe(Effect.provide(appLayer));
      modelResults.set(
        q,
        hits.map((h) => ({ path: h.notePath, score: h.score, snippet: h.chunkText.slice(0, 200) })),
      );
    }
    perModelResults.set(model.kind, modelResults);

    yield* Effect.tryPromise({
      try: () => runtime.dispose(),
      catch: (cause) => new Error(`runtime dispose failed: ${String(cause)}`),
    });
  }

  // Side-by-side report.
  for (const q of queries) {
    // eslint-disable-next-line no-console
    console.log("\n========================================");
    // eslint-disable-next-line no-console
    console.log(`QUERY: ${q}`);
    // eslint-disable-next-line no-console
    console.log("----------------------------------------");
    for (const model of models) {
      const hits = perModelResults.get(model.kind)?.get(q) ?? [];
      // eslint-disable-next-line no-console
      console.log(`\n[${model.kind}]`);
      hits.forEach((h, i) => {
        // eslint-disable-next-line no-console
        console.log(`  ${i + 1}. (${h.score.toFixed(3)}) ${h.path}`);
        // eslint-disable-next-line no-console
        console.log(`     ${h.snippet.replace(/\s+/g, " ").trim()}`);
      });
    }
  }
});

interface EvalHit {
  readonly path: string;
  readonly score: number;
  readonly snippet: string;
}

const program = main.pipe(
  Effect.provide(Logger.replace(Logger.defaultLogger, cloudRunLogger)),
  Logger.withMinimumLogLevel(LogLevel.Info),
);

Effect.runPromise(
  Effect.catchAllCause(program, (cause) =>
    Effect.sync(() => {
      // eslint-disable-next-line no-console
      console.error("eval fatal:", cause.toString());
      process.exit(1);
    }),
  ),
).then(() => process.exit(0));
