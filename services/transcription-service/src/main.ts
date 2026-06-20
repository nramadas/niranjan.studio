// Long-running entrypoint for the transcription-service.
//
// Boot order:
//   1. Resolve config from env (fails fast on missing vars).
//   2. Select + build the Transcriber backend, and resolve it once so a
//      misconfiguration (e.g. TRANSCRIBER=deepgram with no key) fails loud
//      at boot rather than on the first request.
//   3. Start the HTTP server (/health, /transcribe).
//   4. Install SIGTERM/SIGINT handlers that close the server and exit.
//
// Same shape as the vault-indexer / obsidian-mcp main.ts — only the layer
// set differs. There is no background work here (no _changes feed), so the
// service is purely request-driven and scales to zero on Cloud Run.

import { cloudRunLogger } from "@niranjan/vault-shared/lib/cloudRunLogger";
import { Effect, LogLevel, Logger, ManagedRuntime } from "effect";
import { allConfig } from "./config/allConfig";
import { buildHttpServer } from "./http/buildHttpServer";
import { Transcriber } from "./transcribe/Transcriber";
import { selectTranscriberLayer } from "./transcribe/selectTranscriberLayer";

const main = Effect.gen(function* () {
  const cfg = yield* allConfig;
  yield* Effect.logInfo(
    `booting transcription-service on ${cfg.server.bindAddr}:${cfg.server.port} (transcriber=${cfg.transcriber.kind})`,
  );

  const transcriberLayer = selectTranscriberLayer({
    kind: cfg.transcriber.kind,
    deepgramApiKey: cfg.transcriber.deepgramApiKey,
    deepgramModel: cfg.transcriber.deepgramModel,
  });

  const runtime = ManagedRuntime.make(transcriberLayer);

  // Resolve the Transcriber once to validate config at boot — a failing
  // layer (e.g. missing Deepgram key) surfaces here and crashes the
  // process, instead of starting a server that 500s on first use.
  const transcriber = yield* Transcriber.pipe(Effect.provide(transcriberLayer));
  yield* Effect.logInfo(`transcriber ready: ${transcriber.modelName}`);

  const { listen, close } = buildHttpServer(
    {
      port: cfg.server.port,
      bindAddr: cfg.server.bindAddr,
      bearer: cfg.authToken.bearer,
    },
    runtime as never,
  );
  yield* Effect.tryPromise({
    try: () => listen(),
    catch: (cause) => new Error(`HTTP server failed to listen: ${String(cause)}`),
  });
  yield* Effect.logInfo(`listening on ${cfg.server.bindAddr}:${cfg.server.port}`);

  const shutdown = (signal: string) =>
    runtime
      .runPromise(Effect.logInfo(`received ${signal}; shutting down...`))
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
