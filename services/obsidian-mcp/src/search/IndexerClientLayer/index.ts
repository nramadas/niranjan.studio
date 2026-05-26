import { IndexerUnavailableError } from "@niranjan/vault-shared/lib/errors";
import { Effect, Layer, Option, Redacted } from "effect";
import { IndexerClient, type IndexerClientImpl, type IndexerHit } from "../IndexerClient";

interface Params {
  readonly url: string;
  readonly bearer: Redacted.Redacted<string>;
  readonly cfAccessClientId: Option.Option<Redacted.Redacted<string>>;
  readonly cfAccessClientSecret: Option.Option<Redacted.Redacted<string>>;
  readonly timeoutMs: number;
}

/**
 * Build the Layer that provides the `IndexerClient` tag. Uses Node's
 * built-in `fetch` (Node 22) and an `AbortController` for the timeout.
 *
 * The client sends, in order:
 *   - `Authorization: Bearer <bearer>` — verified by the indexer itself.
 *   - `CF-Access-Client-Id` / `CF-Access-Client-Secret` — verified by
 *     Cloudflare Access at the tunnel edge. Omitted only in local-dev
 *     when both options are None.
 *
 * Every failure path produces an `IndexerUnavailableError` with the
 * tagged `reason` so `hybridSearch` can degrade gracefully.
 *
 * @param params Resolved `indexerConfig`.
 * @returns      Layer providing IndexerClient.
 */
export const IndexerClientLayer = (params: Params) =>
  Layer.succeed(IndexerClient, buildImpl(params));

const buildImpl = (params: Params): IndexerClientImpl => {
  const trimmed = params.url.replace(/\/+$/, "");
  return {
    search: (query, limit) =>
      Effect.gen(function* () {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), params.timeoutMs);

        const headers: Record<string, string> = {
          "Content-Type": "application/json",
          Authorization: `Bearer ${Redacted.value(params.bearer)}`,
        };
        Option.match(params.cfAccessClientId, {
          onNone: () => undefined,
          onSome: (v) => {
            headers["CF-Access-Client-Id"] = Redacted.value(v);
          },
        });
        Option.match(params.cfAccessClientSecret, {
          onNone: () => undefined,
          onSome: (v) => {
            headers["CF-Access-Client-Secret"] = Redacted.value(v);
          },
        });

        const res = yield* Effect.tryPromise({
          try: () =>
            fetch(`${trimmed}/search`, {
              method: "POST",
              headers,
              body: JSON.stringify({ query, limit }),
              signal: controller.signal,
            }),
          catch: (cause) => {
            const isAbort = cause instanceof Error && cause.name === "AbortError";
            return new IndexerUnavailableError({
              reason: isAbort ? "timeout" : "network",
              message: isAbort
                ? `indexer /search timed out after ${params.timeoutMs}ms`
                : `indexer /search network error: ${
                    cause instanceof Error ? cause.message : String(cause)
                  }`,
              cause,
            });
          },
        }).pipe(Effect.ensuring(Effect.sync(() => clearTimeout(timer))));

        if (!res.ok) {
          const body = yield* Effect.promise(() => res.text().catch(() => ""));
          return yield* Effect.fail(
            new IndexerUnavailableError({
              reason: "bad_status",
              status: res.status,
              message: `indexer /search returned ${res.status}: ${body.slice(0, 300)}`,
            }),
          );
        }

        const json = yield* Effect.tryPromise({
          try: () => res.json() as Promise<{ hits?: ReadonlyArray<unknown> }>,
          catch: (cause) =>
            new IndexerUnavailableError({
              reason: "bad_body",
              message: `indexer /search returned non-JSON body: ${
                cause instanceof Error ? cause.message : String(cause)
              }`,
              cause,
            }),
        });

        if (!json || !Array.isArray(json.hits)) {
          return yield* Effect.fail(
            new IndexerUnavailableError({
              reason: "bad_body",
              message: `indexer /search response missing 'hits' array`,
            }),
          );
        }

        const out: IndexerHit[] = [];
        for (const h of json.hits) {
          if (!h || typeof h !== "object") continue;
          const obj = h as Partial<IndexerHit>;
          if (
            typeof obj.notePath === "string" &&
            typeof obj.chunkIndex === "number" &&
            typeof obj.chunkText === "string" &&
            typeof obj.score === "number"
          ) {
            out.push({
              notePath: obj.notePath,
              chunkIndex: obj.chunkIndex,
              chunkText: obj.chunkText,
              score: obj.score,
            });
          }
        }
        return out as ReadonlyArray<IndexerHit>;
      }),
  };
};
