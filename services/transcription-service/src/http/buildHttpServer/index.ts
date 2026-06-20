import { type IncomingMessage, type ServerResponse, createServer } from "node:http";
import { Cause, Effect, type Exit, type ManagedRuntime, Redacted } from "effect";
import { z } from "zod";
import { Transcriber } from "../../transcribe/Transcriber";
import type { AudioInput } from "../../transcribe/types.ts";
import { validateBearer } from "../validateBearer";

interface Params {
  readonly port: number;
  readonly bindAddr: string;
  readonly bearer: Redacted.Redacted<string>;
}

interface RuntimeShape<R> {
  readonly runPromiseExit: <A, E>(effect: Effect.Effect<A, E, R>) => Promise<Exit.Exit<A, E>>;
}

const transcribeSchema = z
  .object({
    audioUrl: z.string().url().optional(),
    audioBase64: z.string().min(1).optional(),
    mimeType: z.string().min(1).optional(),
    diarize: z.boolean().default(true),
  })
  .refine((b) => Boolean(b.audioUrl) !== Boolean(b.audioBase64), {
    message: "provide exactly one of audioUrl or audioBase64",
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

const formatErr = (err: unknown): string =>
  err instanceof Error ? (err.stack ?? `${err.name}: ${err.message}`) : String(err);

/**
 * Build the transcription-service HTTP server.
 *
 *   - `GET  /health`     — unauthenticated liveness probe. `{ ok: true }`.
 *     The deploy script polls this to gate "did the new revision come up?".
 *   - `POST /transcribe` — bearer-gated (behind Cloud Run IAM). Body
 *     `{ audioUrl? | audioBase64?, mimeType?, diarize? }`, exactly one of
 *     audioUrl/audioBase64. Returns the `TranscriptResult`. 400 on bad
 *     body, 401 on bad bearer, 500 on backend error (always a JSON body).
 *
 * No CORS — the only caller is obsidian-mcp, server-to-server.
 *
 * @param params  Resolved server config + bearer token.
 * @param runtime A live ManagedRuntime with the Transcriber tag resolved.
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
      jsonReply(res, 200, { ok: true });
      return;
    }

    if (path === "/transcribe" && method === "POST") {
      // The app-layer bearer travels in X-Transcription-Token, NOT
      // Authorization — Cloud Run IAM consumes the Authorization header for
      // the caller's Google-signed ID token before the request reaches this
      // container, so we can't reuse it for the app-layer check.
      const tokenHeader = req.headers["x-transcription-token"];
      const tokenValue = Array.isArray(tokenHeader) ? tokenHeader[0] : tokenHeader;
      if (!validateBearer(tokenValue, expected)) {
        jsonReply(res, 401, { error: "unauthorized" });
        return;
      }
      void readBody(req)
        .then(async (rawBody) => {
          let parsed: z.infer<typeof transcribeSchema>;
          try {
            parsed = transcribeSchema.parse(JSON.parse(rawBody || "{}"));
          } catch (err) {
            jsonReply(res, 400, { error: "invalid_body", message: formatErr(err) });
            return;
          }

          const audio: AudioInput = parsed.audioUrl
            ? { url: parsed.audioUrl }
            : { bytes: Buffer.from(parsed.audioBase64 ?? "", "base64"), mimeType: parsed.mimeType };

          const effect = Effect.flatMap(Transcriber, (t) =>
            t.transcribe(audio, { diarize: parsed.diarize }),
          );
          const exit = await runtime.runPromiseExit(effect as never);
          if (exit._tag === "Success") {
            jsonReply(res, 200, exit.value);
            return;
          }
          const pretty = Cause.pretty(exit.cause);
          // eslint-disable-next-line no-console
          console.error(`/transcribe: ${pretty}`);
          jsonReply(res, 500, { error: "server_error", message: pretty });
        })
        .catch((err) => {
          // A client disconnect / aborted upload rejects readBody. Handle it
          // so the rejection isn't unhandled (Node 22 crashes on that) and the
          // socket isn't left hanging.
          // eslint-disable-next-line no-console
          console.error(`/transcribe readBody failed: ${formatErr(err)}`);
          if (!res.headersSent) {
            jsonReply(res, 400, { error: "read_error" });
          } else {
            res.end();
          }
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
