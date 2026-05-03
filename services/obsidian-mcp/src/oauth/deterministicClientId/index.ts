import { createHash } from "node:crypto";

/**
 * Stable client identifier derived from the registered client metadata.
 *
 * Dynamic Client Registration (RFC 7591) normally requires the server to
 * remember every registration in storage. We don't — the MCP server is
 * stateless on Cloud Run, and the security boundary for public clients
 * is PKCE, not client authentication. Hashing the canonical metadata
 * gives every caller a deterministic id that survives restarts and is
 * the same across replicas.
 *
 * The hash includes only the fields that meaningfully identify a
 * client; transient fields (timestamps, generated secrets) are
 * deliberately excluded so a client that registers twice gets the same
 * id back.
 *
 * @param metadata Subset of the DCR client metadata document.
 * @returns        A URL-safe base64 SHA-256 of the canonicalized metadata.
 */
export const deterministicClientId = (metadata: {
  readonly client_name?: string;
  readonly redirect_uris: ReadonlyArray<string>;
  readonly grant_types?: ReadonlyArray<string>;
  readonly token_endpoint_auth_method?: string;
}): string => {
  const canonical = JSON.stringify({
    client_name: metadata.client_name ?? "",
    redirect_uris: [...metadata.redirect_uris].sort(),
    grant_types: metadata.grant_types ? [...metadata.grant_types].sort() : [],
    token_endpoint_auth_method: metadata.token_endpoint_auth_method ?? "none",
  });
  return createHash("sha256").update(canonical).digest("base64url");
};
