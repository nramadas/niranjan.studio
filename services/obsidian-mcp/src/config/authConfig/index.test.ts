import { describe, expect, it } from "vitest";
import { ConfigProvider, Effect, Redacted } from "effect";
import { authConfig } from "./index.ts";

describe("authConfig", () => {
  it("defaults provider to cloudflare-access", async () => {
    const out = await Effect.runPromise(
      authConfig.pipe(
        Effect.withConfigProvider(
          ConfigProvider.fromMap(new Map([["MCP_BEARER_TOKEN", "x".repeat(48)]])),
        ),
      ),
    );
    expect(out.provider).toBe("cloudflare-access");
    expect(Redacted.value(out.bearerToken)).toHaveLength(48);
  });

  it("accepts AUTH_PROVIDER=disabled", async () => {
    const out = await Effect.runPromise(
      authConfig.pipe(
        Effect.withConfigProvider(
          ConfigProvider.fromMap(
            new Map([
              ["AUTH_PROVIDER", "disabled"],
              ["MCP_BEARER_TOKEN", "secret"],
            ]),
          ),
        ),
      ),
    );
    expect(out.provider).toBe("disabled");
  });
});
