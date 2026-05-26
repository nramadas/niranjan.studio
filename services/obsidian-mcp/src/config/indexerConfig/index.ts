import { Config } from "effect";

/**
 * Typed config for the vault-indexer client. The MCP server's `search_notes`
 * tool calls the indexer's private `/search` endpoint as the semantic
 * arm of hybrid retrieval. If the indexer is unreachable, `search_notes`
 * degrades to lexical-only with a warning — see `hybridSearch`.
 *
 * `url`            — Public URL of the indexer (e.g. https://indexer.<domain>).
 *                    The tunnel route makes this a Cloudflare Access-gated
 *                    hostname; the bearer token is enforced at the
 *                    indexer itself as a second defence-in-depth layer.
 * `bearer`         — Shared secret between the MCP server and the
 *                    indexer. Same value the indexer reads as SEARCH_BEARER_TOKEN.
 * `cfAccessClientId` / `cfAccessClientSecret`
 *                  — Cloudflare Access service-token credentials. Both
 *                    optional; when both present the client sends them
 *                    so Cloudflare admits the request. When the indexer
 *                    is reachable some other way (local dev), leave unset.
 * `timeoutMs`      — Hard timeout on the /search request. The MCP tool
 *                    must not block Claude indefinitely if the indexer
 *                    hangs; failing fast triggers the lexical-only fallback.
 *
 * For local dev set INDEXER_URL=http://localhost:8081 and only the
 * bearer; skip the CF Access fields.
 */
export const indexerConfig = Config.all({
  url: Config.string("INDEXER_URL"),
  bearer: Config.redacted("INDEXER_BEARER_TOKEN"),
  cfAccessClientId: Config.redacted("INDEXER_CF_ACCESS_CLIENT_ID").pipe(Config.option),
  cfAccessClientSecret: Config.redacted("INDEXER_CF_ACCESS_CLIENT_SECRET").pipe(Config.option),
  timeoutMs: Config.integer("INDEXER_TIMEOUT_MS").pipe(Config.withDefault(3000)),
});
