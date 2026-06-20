import { Config } from "effect";
import { authTokenConfig } from "../authTokenConfig";
import { serverConfig } from "../serverConfig";
import { transcriberConfig } from "../transcriberConfig";

/**
 * The combined config tree resolved once at boot. Composing the per-area
 * configs into a single `Config.all` means env-var resolution happens once
 * and any failure surfaces as one structured error from
 * `Effect.runPromise(allConfig)`.
 */
export const allConfig = Config.all({
  server: serverConfig,
  transcriber: transcriberConfig,
  authToken: authTokenConfig,
});

export type AppConfig = Config.Config.Success<typeof allConfig>;
