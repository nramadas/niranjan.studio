import { Config } from "effect";

/**
 * Typed config for the transcription-service HTTP server. `PORT` defaults
 * to 8080 to match the port Cloud Run injects; `BIND_ADDR` to 0.0.0.0
 * inside the container.
 */
export const serverConfig = Config.all({
  port: Config.integer("PORT").pipe(Config.withDefault(8080)),
  bindAddr: Config.string("BIND_ADDR").pipe(Config.withDefault("0.0.0.0")),
  logLevel: Config.literal(
    "debug",
    "info",
    "warn",
    "error",
  )("LOG_LEVEL").pipe(Config.withDefault("info" as const)),
});
