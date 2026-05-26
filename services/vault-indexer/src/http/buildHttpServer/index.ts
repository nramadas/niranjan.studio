import { type IncomingMessage, type ServerResponse, createServer } from "node:http";
import { Cause, Effect, type Exit, type ManagedRuntime, Redacted } from "effect";
import { z } from "zod";
import { semanticSearch } from "../../search/semanticSearch";
import { VectorStore } from "../../store/VectorStore";
import { validateBearer } from "../validateBearer";

interface Params {
  readonly port: number;
  readonly bindAddr: string;
  readonly bearer: Redacted.Redacted<string>;
}

interface RuntimeShape<R> {
  readonly runPromiseExit: <A, E>(effect: Effect.Effect<A, E, R>) => Promise<Exit.Exit<A, E>>;
}

const searchSchema = z.object({
  query: z.string().min(1).max(2000),
  limit: z.number().int().positive().max(50).default(10),
});

const jsonReply = (res: ServerResponse, status: number, body: unknown): void => {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
};

const readBody = (req: IncomingMessage): Promise<string> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });

const formatErr = (err: unknown): string => {
  if (err instanceof Error) {
    return err.stack ?? `${err.name}: ${err.message}`;
  }
  return String(err);
};

/**
 * Build the indexer's HTTP server.
 *
 * Two endpoints:
 *   - `GET  /health` — unauthenticated liveness probe. Returns 200 with
 *     `{ ok: true, count: <chunks> }`. The deploy script uses this to
 *     gate "did the new revision come up cleanly?".
 *   - `POST /search` — bearer-gated. Body `{ query: string, limit?: number }`.
 *     Returns `{ hits: SemanticHit[] }`. 400 on invalid body, 401 on bad
 *     bearer, 500 on internal error (always with a JSON body — no opaque
 *     status-only responses).
 *
 * No CORS — the only caller is the MCP server, server-to-server through
 * the Cloudflare tunnel. CORS would just open an attack surface.
 *
 * @param params  Resolved server config + bearer token.
 * @param runtime A live ManagedRuntime that has the Embedder + VectorStore tags resolved.
 * @returns       The node:http Server, not yet listening.
 */
export const buildHttpServer = <R>(
  params: Params,
  runtime: ManagedRuntime.ManagedRuntime<R, never> & RuntimeShape<R>,
) => {
  const expected = Redacted.value(params.bearer);

  const server = createServer((req, res) => {
    const url = req.url ?? "/";
    const path = url.split("?")[0] ?? "/";
    const method = req.method ?? "GET";

    if (path === "/health" && method === "GET") {
      void runtime
        .runPromiseExit(
          Effect.flatMap(
            VectorStore as never,
            (s: { count: () => Effect.Effect<number, unknown> }) => s.count(),
          ),
        )
        .then((exit) => {
          // Health responds 200 even on a count failure so the deploy
          // script doesn't tear down the container over a transient
          // SQLite hiccup; the count value just becomes `null` and the
          // log line warns. The container's liveness is "did the
          // process come up and serve a TCP response," which is exactly
          // what we want here.
          if (exit._tag === "Success") {
            jsonReply(res, 200, { ok: true, count: exit.value });
          } else {
            // eslint-disable-next-line no-console
            console.warn(`/health: count failed: ${Cause.pretty(exit.cause)}`);
            jsonReply(res, 200, { ok: true, count: null });
          }
        });
      return;
    }

    if (path === "/search" && method === "POST") {
      if (!validateBearer(req.headers.authorization, expected)) {
        jsonReply(res, 401, { error: "unauthorized" });
        return;
      }
      void readBody(req).then(async (rawBody) => {
        let parsed: { query: string; limit?: number };
        try {
          parsed = searchSchema.parse(JSON.parse(rawBody || "{}"));
        } catch (err) {
          jsonReply(res, 400, {
            error: "invalid_body",
            message: formatErr(err),
          });
          return;
        }
        const exit = await runtime.runPromiseExit(
          semanticSearch(parsed.query, parsed.limit ?? 10) as never,
        );
        if (exit._tag === "Success") {
          jsonReply(res, 200, { hits: exit.value });
          return;
        }
        const pretty = Cause.pretty(exit.cause);
        // eslint-disable-next-line no-console
        console.error(`/search: ${pretty}`);
        jsonReply(res, 500, { error: "server_error", message: pretty });
      });
      return;
    }

    jsonReply(res, 404, { error: "not_found", path, method });
  });

  return {
    server,
    listen: (): Promise<void> =>
      new Promise((resolve) => {
        server.listen(params.port, params.bindAddr, () => resolve());
      }),
    close: (): Promise<void> =>
      new Promise((resolve) => {
        server.close(() => resolve());
      }),
  };
};
