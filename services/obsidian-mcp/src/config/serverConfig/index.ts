import { Config } from "effect";

/**
 * Typed config for the HTTP server boundary. `port` defaults to 8080
 * because that's what Cloud Run expects; `hostname` is the public-facing
 * value used in CORS and logging; `logLevel` controls the minimum severity
 * the cloudRunLogger emits.
 */
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
