import { describe, expect, it } from "vitest";
import { ConfigProvider, Effect } from "effect";
import { serverConfig } from "./index.ts";

describe("serverConfig", () => {
  it("applies sensible defaults", async () => {
    const out = await Effect.runPromise(
      serverConfig.pipe(
        Effect.withConfigProvider(ConfigProvider.fromMap(new Map())),
      ),
    );
    expect(out.port).toBe(8080);
    expect(out.hostname).toBe("localhost:8080");
    expect(out.logLevel).toBe("info");
  });

  it("respects overrides", async () => {
    const out = await Effect.runPromise(
      serverConfig.pipe(
        Effect.withConfigProvider(
          ConfigProvider.fromMap(
            new Map([
              ["PORT", "9090"],
              ["MCP_HOSTNAME", "mcp.example.studio"],
              ["LOG_LEVEL", "debug"],
            ]),
          ),
        ),
      ),
    );
    expect(out.port).toBe(9090);
    expect(out.hostname).toBe("mcp.example.studio");
    expect(out.logLevel).toBe("debug");
  });
});
