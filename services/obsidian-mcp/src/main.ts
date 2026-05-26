// Service entrypoint.
//
// Boot order:
//   1. Resolve config from env (fails fast on missing vars).
//   2. Build runtime layers: CouchClient, Vault, SearchIndex, SigningKey,
//      OAuth AuthProvider.
//   3. Start a node:http server that:
//        a. Serves /health unauthenticated.
//        b. Serves the OAuth metadata + JWKS + DCR + /authorize +
//           /oauth/google/callback + /token endpoints (all unauthenticated;
//           OAuth itself bootstraps trust).
//        c. Runs the OAuthAuthProvider on /mcp and rejects unauthenticated
//           requests; on success builds a fresh McpServer +
//           StreamableHTTPServerTransport for that single request and hands
//           off to it. The SDK's stateless mode requires a new transport
//           per request — reusing one throws on the second handleRequest.
//   4. Subscribe to the CouchDB _changes feed and tell the search index to
//      mark itself dirty whenever something changes.
//
// The HTTP layer is intentionally thin (raw node:http). Effect drives
// everything inside the request lifecycle.

import { type IncomingMessage, type ServerResponse, createServer } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { Cause, Effect, Exit, Layer, LogLevel, Logger, ManagedRuntime } from "effect";

import {
  CouchClient,
  CouchClientLayer,
  VaultLayer,
  subscribeChanges,
} from "@niranjan/vault-shared/couchdb";
import { cloudRunLogger } from "@niranjan/vault-shared/lib";
import { AuthProvider, OAuthAuthProviderLayer, types as authTypes } from "./auth";
import { allConfig } from "./config";
import { buildMcpServer } from "./mcp";
import {
  SigningKey,
  SigningKeyLayer,
  handlers as oauthHandlers,
  types as oauthTypes,
} from "./oauth";
import { IndexerClientLayer, SearchIndex, SearchIndexLayer } from "./search";

type AuthRequest = authTypes.AuthRequest;
type HandlerResponse = oauthTypes.HandlerResponse;

const toAuthRequest = (req: IncomingMessage): AuthRequest => ({
  header: (name) => {
    const v = req.headers[name.toLowerCase()];
    return Array.isArray(v) ? v[0] : v;
  },
  path: req.url ?? "/",
  method: req.method ?? "GET",
});

const setCors = (res: ServerResponse) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS, DELETE");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, Mcp-Session-Id");
};

const sendJson = (res: ServerResponse, status: number, body: unknown) => {
  setCors(res);
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
};

const applyHandlerResponse = (res: ServerResponse, hr: HandlerResponse) => {
  setCors(res);
  if (hr.kind === "json") {
    res.statusCode = hr.status;
    res.setHeader("Content-Type", "application/json");
    if (hr.headers) {
      for (const [k, v] of Object.entries(hr.headers)) res.setHeader(k, v);
    }
    res.end(JSON.stringify(hr.body));
    return;
  }
  res.statusCode = hr.status;
  res.setHeader("Location", hr.location);
  res.end();
};

const sendOAuthError = (
  res: ServerResponse,
  err: { code: string; description: string; statusCode: number },
) => {
  // Per RFC 6749 §5.2 the error body is { error, error_description }.
  // We log every failure server-side too — silent OAuth errors are the
  // worst possible developer experience.
  console.warn(`OAuthError ${err.statusCode} ${err.code}: ${err.description}`);
  sendJson(res, err.statusCode, { error: err.code, error_description: err.description });
};

const readBody = (req: IncomingMessage): Promise<string> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });

const parseQuery = (url: string): Record<string, string | undefined> => {
  const out: Record<string, string | undefined> = {};
  const parsed = new URL(url, "http://placeholder");
  for (const [k, v] of parsed.searchParams.entries()) out[k] = v;
  return out;
};

const parseFormBody = (body: string): Record<string, string | undefined> => {
  const out: Record<string, string | undefined> = {};
  const params = new URLSearchParams(body);
  for (const [k, v] of params.entries()) out[k] = v;
  return out;
};

// Defensive: TaggedError instances and many SDK errors aren't ordinary
// `Error`s, so `err.message` / `err.stack` come back undefined and the
// log line becomes useless. Walk own properties as a fallback so we
// always get something readable in Cloud Logging.
const formatErr = (err: unknown): string => {
  if (err instanceof Error) {
    const stack = err.stack ?? `${err.name}: ${err.message}`;
    const extras = Object.getOwnPropertyNames(err).filter(
      (k) => k !== "name" && k !== "message" && k !== "stack",
    );
    if (extras.length === 0) return stack;
    const fields: Record<string, unknown> = {};
    for (const k of extras) fields[k] = (err as unknown as Record<string, unknown>)[k];
    return `${stack}\nfields: ${JSON.stringify(fields)}`;
  }
  if (err && typeof err === "object") {
    try {
      return JSON.stringify(err, Object.getOwnPropertyNames(err));
    } catch {
      return Object.prototype.toString.call(err);
    }
  }
  return String(err);
};

const parseJsonBody = (body: string): Record<string, unknown> => {
  if (!body) return {};
  try {
    const v = JSON.parse(body);
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch (err) {
    console.warn(`parseJsonBody: invalid JSON, treating as empty object: ${formatErr(err)}`);
    return {};
  }
};

const main = Effect.gen(function* () {
  const cfg = yield* allConfig;
  yield* Effect.logInfo(`booting obsidian-mcp on :${cfg.server.port} (auth=oauth)`);

  const couchLayer = CouchClientLayer(cfg.couchDb);
  const vaultLayer = VaultLayer(cfg.liveSync.passphrase).pipe(Layer.provide(couchLayer));
  const searchLayer = SearchIndexLayer(cfg.search.rebuildDebounceMs).pipe(
    Layer.provide(vaultLayer),
  );
  const indexerLayer = IndexerClientLayer({
    url: cfg.indexer.url,
    bearer: cfg.indexer.bearer,
    cfAccessClientId: cfg.indexer.cfAccessClientId,
    cfAccessClientSecret: cfg.indexer.cfAccessClientSecret,
    timeoutMs: cfg.indexer.timeoutMs,
  });
  const signingLayer = SigningKeyLayer(cfg.oauth);
  const authLayer = OAuthAuthProviderLayer({
    issuer: cfg.oauth.issuer,
    audience: cfg.oauth.issuer,
  }).pipe(Layer.provide(signingLayer));

  const appLayer = Layer.mergeAll(
    couchLayer,
    vaultLayer,
    searchLayer,
    indexerLayer,
    signingLayer,
    authLayer,
  );
  const runtime = ManagedRuntime.make(appLayer);
  const innerRuntime = yield* Effect.promise(() => runtime.runtime());

  // Subscribe to the changes feed → mark search dirty on every event.
  const couch = yield* CouchClient.pipe(Effect.provide(couchLayer));
  const search = yield* SearchIndex.pipe(Effect.provide(searchLayer));
  yield* subscribeChanges(couch.raw(), () => {
    // markDirty itself doesn't fail today, but a forked Effect with an
    // unobserved failure is a silent-error hazard, so route any future
    // failure through Cloud Logging.
    Effect.runFork(
      search
        .markDirty()
        .pipe(
          Effect.catchAllCause((cause) =>
            Effect.logError(`search.markDirty failed: ${Cause.pretty(cause)}`),
          ),
        ),
    );
  });

  // Build a fresh McpServer + transport for each /mcp request. Stateless
  // mode requires this — the SDK throws "Stateless transport cannot be
  // reused across requests" on the second handleRequest call (see
  // webStandardStreamableHttp.js _hasHandledRequest check). The throw is
  // swallowed by @hono/node-server before our await returns, so the
  // symptom is just an undecorated 500. buildMcpServer is pure — it only
  // closes over the long-lived runtime and registers tool factories — so
  // per-request construction is cheap.
  const buildPerRequestMcp = () => {
    const server = buildMcpServer(innerRuntime);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    // Without this, every internal SDK failure path (auth, parse,
    // validation, the SSE writer) calls a no-op and we lose the only
    // useful diagnostic. The outer try/catch can't catch these because
    // @hono/node-server already wrote the 500 by the time our await
    // returns.
    transport.onerror = (err: Error) => {
      console.error(`mcp transport error: ${formatErr(err)}`);
    };
    return { server, transport };
  };

  // Helper that runs an OAuth handler effect and maps the Exit to HTTP.
  // Tagged OAuthErrors render per RFC 6749; anything else logs + 500s.
  const runHandler = async (
    res: ServerResponse,
    eff: Effect.Effect<HandlerResponse, unknown, never>,
  ) => {
    const exit = await runtime.runPromiseExit(
      eff as Effect.Effect<HandlerResponse, unknown, never>,
    );
    if (Exit.isSuccess(exit)) {
      applyHandlerResponse(res, exit.value);
      return;
    }
    const failure = Cause.failureOption(exit.cause);
    if (failure._tag === "Some") {
      const inner = failure.value as { _tag?: unknown };
      if (
        inner &&
        typeof inner === "object" &&
        "_tag" in inner &&
        (inner as { _tag: unknown })._tag === "OAuthError"
      ) {
        sendOAuthError(
          res,
          inner as unknown as { code: string; description: string; statusCode: number },
        );
        return;
      }
    }
    const pretty = Cause.pretty(exit.cause);
    console.error(`request failed: ${pretty}`);
    sendJson(res, 500, { error: "server_error", error_description: pretty });
  };

  const httpServer = createServer((req, res) => {
    // CORS preflight from web-based MCP clients (Claude on web).
    if (req.method === "OPTIONS") {
      setCors(res);
      res.statusCode = 204;
      res.end();
      return;
    }

    const url = req.url ?? "/";
    const path = url.split("?")[0] ?? "/";
    const method = req.method ?? "GET";

    // Unauthenticated endpoints — OAuth bootstraps trust, so all of these
    // must be reachable without credentials.

    if (path === "/health" && method === "GET") {
      sendJson(res, 200, { ok: true });
      return;
    }

    if (path === "/.well-known/oauth-authorization-server" && method === "GET") {
      void runHandler(res, oauthHandlers.handleAuthorizationServerMetadata(cfg.oauth.issuer));
      return;
    }

    if (path === "/.well-known/oauth-protected-resource" && method === "GET") {
      void runHandler(res, oauthHandlers.handleProtectedResourceMetadata(cfg.oauth.issuer));
      return;
    }

    if (path === "/.well-known/jwks.json" && method === "GET") {
      void runHandler(
        res,
        oauthHandlers.handleJwks() as Effect.Effect<HandlerResponse, never, never>,
      );
      return;
    }

    if (path === "/register" && method === "POST") {
      void readBody(req).then((body) => {
        void runHandler(res, oauthHandlers.handleRegister(parseJsonBody(body)));
      });
      return;
    }

    if (path === "/authorize" && method === "GET") {
      const q = parseQuery(url);
      void runHandler(
        res,
        oauthHandlers.handleAuthorize(q, {
          googleClientId: cfg.googleOidc.clientId,
          googleClientSecret: cfg.googleOidc.clientSecret,
          googleRedirectUri: cfg.googleOidc.redirectUri,
          googleStateTtlSeconds: cfg.oauth.googleStateTtlSeconds,
        }) as Effect.Effect<HandlerResponse, unknown, never>,
      );
      return;
    }

    if (path === "/oauth/google/callback" && method === "GET") {
      const q = parseQuery(url);
      void runHandler(
        res,
        oauthHandlers.handleGoogleCallback(q, {
          googleClientId: cfg.googleOidc.clientId,
          googleClientSecret: cfg.googleOidc.clientSecret,
          googleRedirectUri: cfg.googleOidc.redirectUri,
          authorizationCodeTtlSeconds: cfg.oauth.authorizationCodeTtlSeconds,
          allowedEmails: cfg.allowedEmails.emails,
        }) as Effect.Effect<HandlerResponse, unknown, never>,
      );
      return;
    }

    if (path === "/token" && method === "POST") {
      void readBody(req).then((body) => {
        void runHandler(
          res,
          oauthHandlers.handleToken(parseFormBody(body), {
            issuer: cfg.oauth.issuer,
            accessTokenTtlSeconds: cfg.oauth.accessTokenTtlSeconds,
            refreshTokenTtlSeconds: cfg.oauth.refreshTokenTtlSeconds,
          }) as Effect.Effect<HandlerResponse, unknown, never>,
        );
      });
      return;
    }

    // Authenticated MCP endpoint.
    if (path === "/mcp" || path.startsWith("/mcp/")) {
      const authReq = toAuthRequest(req);
      const program = Effect.gen(function* () {
        const provider = yield* AuthProvider;
        return yield* provider.validateRequest(authReq);
      });
      runtime
        .runPromiseExit(program)
        .then(async (exit) => {
          if (Exit.isSuccess(exit)) {
            const identity = exit.value;
            // Stuff identity onto the request for tools that want it (none yet,
            // but matches MCP SDK's `auth` shape).
            (
              req as IncomingMessage & {
                auth?: { token: string; clientId: string; scopes: string[]; extra: unknown };
              }
            ).auth = {
              token: "",
              clientId: identity.email,
              scopes: [],
              extra: { source: identity.source, ...(identity.extra ?? {}) },
            };
            setCors(res);
            const { server, transport } = buildPerRequestMcp();
            // Tear down the per-request server + transport when the response
            // closes, so we don't leak Server instances / event listeners.
            res.on("close", () => {
              void transport.close().catch((err) => {
                console.error(`transport.close failed: ${formatErr(err)}`);
              });
              void server.close().catch((err) => {
                console.error(`mcpServer.close failed: ${formatErr(err)}`);
              });
            });
            try {
              await server.connect(transport);
              await transport.handleRequest(req, res);
            } catch (err) {
              console.error(`transport error: ${formatErr(err)}`);
              if (!res.headersSent) {
                sendJson(res, 500, {
                  error: "server_error",
                  error_description: formatErr(err),
                });
              }
            }
            return;
          }

          const failureOpt = Cause.failureOption(exit.cause);
          if (failureOpt._tag === "Some") {
            const inner = failureOpt.value;
            if (
              inner &&
              typeof inner === "object" &&
              "_tag" in inner &&
              (inner as { _tag: unknown })._tag === "AuthError"
            ) {
              const ae = inner as { reason: string; statusCode: 401 | 403 };
              console.warn(`AuthError ${ae.statusCode}: ${ae.reason}`);
              // Per the MCP authorization spec, a 401 on /mcp must include
              // a WWW-Authenticate header pointing at our protected-resource
              // metadata so the client can discover the auth server.
              if (ae.statusCode === 401) {
                res.setHeader(
                  "WWW-Authenticate",
                  `Bearer resource_metadata="${cfg.oauth.issuer}/.well-known/oauth-protected-resource"`,
                );
              }
              sendJson(res, ae.statusCode, { error: "unauthorized", error_description: ae.reason });
              return;
            }
          }
          const pretty = Cause.pretty(exit.cause);
          console.error(`request failed: ${pretty}`);
          sendJson(res, 500, { error: "server_error", error_description: pretty });
        })
        .catch((err) => {
          // Anything thrown inside the .then callback (e.g. a bug in
          // response shaping or a setHeader-after-sent) lands here. Log
          // it; otherwise it becomes an unhandled rejection that Cloud
          // Run merely terminates the process for.
          console.error(`mcp handler crashed: ${formatErr(err)}`);
          if (!res.headersSent) {
            sendJson(res, 500, { error: "server_error", error_description: String(err) });
          }
        });
      return;
    }

    sendJson(res, 404, { error: "not_found", error_description: `no route for ${method} ${path}` });
  });

  yield* Effect.async<void>((resume) => {
    httpServer.listen(cfg.server.port, () => {
      resume(Effect.void);
    });
    httpServer.on("error", (err) => {
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
      console.error("fatal:", cause.toString());
      process.exit(1);
    }),
  ),
).then(() => {
  // Effect.never never resolves, so we shouldn't be here. Belt-and-braces:
  process.exit(0);
});
