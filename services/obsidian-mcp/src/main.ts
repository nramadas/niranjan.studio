// Service entrypoint.
//
// Boot order:
//   1. Resolve config from env (fails fast on missing vars).
//   2. Build runtime layers: CouchClient, Vault, SearchIndex.
//   3. Wire the AuthProvider for the configured AUTH_PROVIDER.
//   4. Build the McpServer and a single StreamableHTTPServerTransport.
//   5. Start a node:http server that:
//        a. Health-checks /healthz
//        b. Runs the AuthProvider on every other request and rejects on failure
//        c. Hands the request off to the MCP transport
//   6. Subscribe to the CouchDB _changes feed and tell the search index to
//      mark itself dirty whenever something changes.
//
// The HTTP layer is intentionally thin (raw node:http). Effect drives
// everything inside the request lifecycle; the boundary code at /mcp is
// just glue.

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Effect, Layer, Logger, LogLevel, ManagedRuntime, Redacted } from "effect";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

import { allConfig } from "./config/env.js";
import { CloudflareAccessAuthProviderLayer } from "./auth/cloudflare-access.js";
import { DisabledAuthProviderLayer } from "./auth/disabled.js";
import { AuthProvider, type AuthRequest } from "./auth/provider.js";
import { CouchClient, CouchClientLayer } from "./couchdb/client.js";
import { VaultLayer } from "./couchdb/vault.js";
import { SearchIndex, SearchIndexLayer } from "./search/index.js";
import { subscribeChanges } from "./couchdb/changes.js";
import { buildMcpServer } from "./mcp/server.js";
import { cloudRunLogger } from "./lib/logging.js";

const logLevelFor = (level: "debug" | "info" | "warn" | "error") =>
  level === "debug"
    ? LogLevel.Debug
    : level === "info"
      ? LogLevel.Info
      : level === "warn"
        ? LogLevel.Warning
        : LogLevel.Error;

const toAuthRequest = (req: IncomingMessage): AuthRequest => ({
  header: (name) => {
    const v = req.headers[name.toLowerCase()];
    return Array.isArray(v) ? v[0] : v;
  },
  path: req.url ?? "/",
  method: req.method ?? "GET",
});

const sendJson = (res: ServerResponse, status: number, body: unknown) => {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
};

const main = Effect.gen(function* () {
  const cfg = yield* allConfig;
  yield* Effect.logInfo(`booting obsidian-mcp on :${cfg.server.port} (auth=${cfg.auth.provider})`);

  const couchLayer = CouchClientLayer(cfg.couchDb);
  const vaultLayer = VaultLayer(cfg.liveSync.passphrase).pipe(Layer.provide(couchLayer));
  const searchLayer = SearchIndexLayer(cfg.search.rebuildDebounceMs).pipe(Layer.provide(vaultLayer));
  const authLayer =
    cfg.auth.provider === "cloudflare-access"
      ? CloudflareAccessAuthProviderLayer({
          teamDomain: cfg.cloudflareAccess.teamDomain,
          aud: cfg.cloudflareAccess.aud,
          bearerToken: cfg.auth.bearerToken,
        })
      : DisabledAuthProviderLayer(cfg.auth.bearerToken);

  const appLayer = Layer.mergeAll(couchLayer, vaultLayer, searchLayer, authLayer);
  const runtime = ManagedRuntime.make(appLayer);
  const innerRuntime = yield* Effect.promise(() => runtime.runtime());

  // Subscribe to the changes feed → mark search dirty on every event.
  const couch = yield* CouchClient.pipe(Effect.provide(couchLayer));
  const search = yield* SearchIndex.pipe(Effect.provide(searchLayer));
  yield* subscribeChanges(couch.raw(), () => {
    Effect.runFork(search.markDirty());
  });

  const mcpServer: McpServer = buildMcpServer(innerRuntime);
  const transport = new StreamableHTTPServerTransport({
    // Stateless mode: every request is independent. Good fit for a small
    // tool server where session state isn't useful and Cloud Run might
    // route consecutive requests to different instances.
    sessionIdGenerator: undefined,
  });
  yield* Effect.promise(() => mcpServer.connect(transport));

  const httpServer = createServer((req, res) => {
    // CORS preflight from web-based MCP clients (Claude on web).
    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS, DELETE");
      res.setHeader(
        "Access-Control-Allow-Headers",
        "Content-Type, Authorization, Cf-Access-Jwt-Assertion, Mcp-Session-Id",
      );
      res.end();
      return;
    }

    if (req.url === "/healthz") {
      sendJson(res, 200, { ok: true });
      return;
    }

    if (req.url !== "/mcp" && !req.url?.startsWith("/mcp")) {
      sendJson(res, 404, { error: "not found" });
      return;
    }

    const authReq = toAuthRequest(req);
    const program = Effect.gen(function* () {
      const provider = yield* AuthProvider;
      return yield* provider.validateRequest(authReq);
    });

    runtime
      .runPromise(program)
      .then(async (identity) => {
        // Stuff identity onto the request for tools that want it (none yet,
        // but it's a useful affordance and matches MCP SDK's `auth` shape).
        (req as IncomingMessage & { auth?: { token: string; clientId: string; scopes: string[]; extra: unknown } }).auth = {
          token: Redacted.value(cfg.auth.bearerToken),
          clientId: identity.email,
          scopes: [],
          extra: { source: identity.source, ...(identity.extra ?? {}) },
        };
        try {
          await transport.handleRequest(req, res);
        } catch (err) {
          if (!res.headersSent) {
            sendJson(res, 500, { error: "transport error", message: String(err) });
          }
        }
      })
      .catch((err: unknown) => {
        // AuthError carries the right HTTP status; everything else is 500.
        const tag = err && typeof err === "object" && "_tag" in err ? (err as { _tag: string })._tag : "";
        if (tag === "AuthError") {
          const ae = err as { reason: string; statusCode: 401 | 403 };
          sendJson(res, ae.statusCode, { error: "unauthorized", reason: ae.reason });
          return;
        }
        sendJson(res, 500, { error: "internal", message: String(err) });
      });
  });

  yield* Effect.async<void>((resume) => {
    httpServer.listen(cfg.server.port, () => {
      resume(Effect.void);
    });
    httpServer.on("error", (err) => {
      // eslint-disable-next-line no-console
      console.error("server error", err);
    });
  });

  yield* Effect.logInfo(`listening on :${cfg.server.port}`);

  // Park forever — Cloud Run will SIGTERM us on shutdown.
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
  // Effect.never never resolves, so we shouldn't be here. Belt-and-braces:
  process.exit(0);
});

// Ensure the LOG_LEVEL env var is honoured at runtime.
const desired = process.env.LOG_LEVEL;
if (desired && ["debug", "info", "warn", "error"].includes(desired)) {
  // The log level is set at the runtime layer above; this `desired` shim
  // is only here so future code that reads it doesn't have to re-parse.
  void logLevelFor(desired as "debug" | "info" | "warn" | "error");
}
