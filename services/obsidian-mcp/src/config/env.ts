// Typed configuration via `effect/Config`. Reads env vars on startup and
// fails the program with a structured error if any are missing or invalid.
// Cloud Run's container fails to boot when this throws, which is the
// behaviour we want (loud failure beats silent default).
//
// The config is split into nested groups so each layer (auth, couchdb, etc.)
// pulls only what it needs.

import { Config } from "effect";

export type AuthProviderKind = "cloudflare-access" | "disabled";

export const couchDbConfig = Config.all({
  url: Config.string("COUCHDB_URL"),
  database: Config.string("COUCHDB_DB"),
  username: Config.string("COUCHDB_USER"),
  password: Config.redacted("COUCHDB_PASSWORD"),
});

export const liveSyncConfig = Config.all({
  passphrase: Config.redacted("LIVESYNC_PASSPHRASE"),
});

export const cloudflareAccessConfig = Config.all({
  teamDomain: Config.string("CF_ACCESS_TEAM_DOMAIN"),
  aud: Config.string("CF_ACCESS_AUD"),
});

export const authConfig = Config.all({
  provider: Config.literal(
    "cloudflare-access",
    "disabled",
  )("AUTH_PROVIDER").pipe(Config.withDefault<AuthProviderKind>("cloudflare-access")),
  bearerToken: Config.redacted("MCP_BEARER_TOKEN"),
});

export const serverConfig = Config.all({
  port: Config.integer("PORT").pipe(Config.withDefault(8080)),
  hostname: Config.string("MCP_HOSTNAME").pipe(Config.withDefault("localhost:8080")),
  logLevel: Config.literal(
    "debug",
    "info",
    "warn",
    "error",
  )("LOG_LEVEL").pipe(Config.withDefault("info" as const)),
});

export const searchConfig = Config.all({
  rebuildDebounceMs: Config.integer("SEARCH_REBUILD_DEBOUNCE_MS").pipe(Config.withDefault(5000)),
});

export const allConfig = Config.all({
  couchDb: couchDbConfig,
  liveSync: liveSyncConfig,
  cloudflareAccess: cloudflareAccessConfig,
  auth: authConfig,
  server: serverConfig,
  search: searchConfig,
});

export type AppConfig = Config.Config.Success<typeof allConfig>;
