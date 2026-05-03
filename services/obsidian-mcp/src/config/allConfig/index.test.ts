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
              ["OAUTH_SIGNING_KEY", "-----BEGIN PRIVATE KEY-----\nFAKE\n-----END PRIVATE KEY-----\n"],
              ["OAUTH_ISSUER", "https://mcp.example"],
              ["GOOGLE_OAUTH_CLIENT_ID", "1234.apps.googleusercontent.com"],
              ["GOOGLE_OAUTH_CLIENT_SECRET", "GOCSPX-secret"],
              ["GOOGLE_OAUTH_REDIRECT_URI", "https://mcp.example/oauth/google/callback"],
              ["ALLOWED_EMAILS", "user@example.com"],
            ]),
          ),
        ),
      ),
    );
    expect(out.couchDb.database).toBe("obsidian");
    expect(Redacted.value(out.liveSync.passphrase)).toBe("diceware");
    expect(out.oauth.issuer).toBe("https://mcp.example");
    expect(out.oauth.accessTokenTtlSeconds).toBe(3600);
    expect(out.googleOidc.clientId).toBe("1234.apps.googleusercontent.com");
    expect(out.allowedEmails.emails.has("user@example.com")).toBe(true);
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
