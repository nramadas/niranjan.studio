import { Config } from "effect";

/**
 * Typed config for the `/search` endpoint's bearer-token gate.
 *
 * This is the second of two defence-in-depth layers in front of the
 * indexer: Cloudflare Access vets the caller's service-token identity at
 * the tunnel edge, then this bearer check enforces "even within the
 * tunnel, only the MCP server can read." The MCP server fetches the same
 * value from Secret Manager (`vault-indexer-search-token`).
 *
 * Required, not defaulted — a missing token must fail loud at boot rather
 * than start an indexer that accepts unauthenticated reads.
 */
export const searchTokenConfig = Config.all({
  bearer: Config.redacted("SEARCH_BEARER_TOKEN"),
});
