import { describe, expect, it } from "vitest";
import { ConfigProvider, Effect, Redacted } from "effect";
import { allConfig } from "./index.ts";

describe("allConfig", () => {
  it("composes all per-area configs into a single tree", async () => {
    const out = await Effect.runPromise(
      allConfig.pipe(
        Effect.withConfigProvider(
          ConfigProvider.fromMap(
            new Map([
              ["COUCHDB_URL", "https://vault.example"],
              ["COUCHDB_DB", "obsidian"],
              ["COUCHDB_USER", "obsidian-mcp"],
              ["COUCHDB_PASSWORD", "couch-secret"],
              ["LIVESYNC_PASSPHRASE", "diceware"],
              ["CF_ACCESS_TEAM_DOMAIN", "team.cloudflareaccess.com"],
              ["CF_ACCESS_AUD", "aud-tag"],
              ["MCP_BEARER_TOKEN", "bearer-secret"],
            ]),
          ),
        ),
      ),
    );
    expect(out.couchDb.database).toBe("obsidian");
    expect(Redacted.value(out.liveSync.passphrase)).toBe("diceware");
    expect(out.auth.provider).toBe("cloudflare-access");
    expect(out.server.port).toBe(8080);
    expect(out.search.rebuildDebounceMs).toBe(5000);
  });

  it("fails when any required field is missing", async () => {
    const exit = await Effect.runPromiseExit(
      allConfig.pipe(Effect.withConfigProvider(ConfigProvider.fromMap(new Map()))),
    );
    expect(exit._tag).toBe("Failure");
  });
});
