import { Config } from "effect";

/**
 * Typed config for the indexer's HTTP server.
 *
 * `port` defaults to 8081 (one above the Cloud Run convention of 8080) so
 * that running the indexer and obsidian-mcp side by side locally is
 * collision-free. `bindAddr` defaults to `0.0.0.0` inside the container —
 * the docker-compose host-side `ports:` binding pins it to `127.0.0.1`,
 * so nothing on the public internet reaches it directly even though the
 * container listens on all interfaces.
 */
export const serverConfig = Config.all({
  port: Config.integer("PORT").pipe(Config.withDefault(8081)),
  bindAddr: Config.string("BIND_ADDR").pipe(Config.withDefault("0.0.0.0")),
  logLevel: Config.literal(
    "debug",
    "info",
    "warn",
    "error",
  )("LOG_LEVEL").pipe(Config.withDefault("info" as const)),
});
