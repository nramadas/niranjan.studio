import { describe, expect, it } from "vitest";
import { ConfigProvider, Effect, Redacted } from "effect";
import { couchDbConfig } from "./index.ts";

const provider = (env: Record<string, string>) =>
  ConfigProvider.fromMap(new Map(Object.entries(env)));

describe("couchDbConfig", () => {
  it("loads all four required fields from env", async () => {
    const out = await Effect.runPromise(
      couchDbConfig.pipe(
        Effect.withConfigProvider(
          provider({
            COUCHDB_URL: "https://vault.example",
            COUCHDB_DB: "obsidian",
            COUCHDB_USER: "obsidian-mcp",
            COUCHDB_PASSWORD: "s3cret",
          }),
        ),
      ),
    );
    expect(out.url).toBe("https://vault.example");
    expect(out.database).toBe("obsidian");
    expect(out.username).toBe("obsidian-mcp");
    expect(Redacted.value(out.password)).toBe("s3cret");
  });

  it("fails fast when a required field is missing", async () => {
    const exit = await Effect.runPromiseExit(
      couchDbConfig.pipe(
        Effect.withConfigProvider(
          provider({
            COUCHDB_URL: "https://vault.example",
            COUCHDB_DB: "obsidian",
            // COUCHDB_USER missing
            COUCHDB_PASSWORD: "s3cret",
          }),
        ),
      ),
    );
    expect(exit._tag).toBe("Failure");
  });
});
