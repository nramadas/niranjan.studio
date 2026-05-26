import { ConfigProvider, Effect } from "effect";
import { describe, expect, it } from "vitest";
import { allowedEmailsConfig } from "./index.ts";

describe("allowedEmailsConfig", () => {
  it("parses comma-separated emails into a lowercased Set", async () => {
    const out = await Effect.runPromise(
      allowedEmailsConfig.pipe(
        Effect.withConfigProvider(
          ConfigProvider.fromMap(
            new Map([["ALLOWED_EMAILS", "Alice@example.com, bob@example.com "]]),
          ),
        ),
      ),
    );
    expect(out.emails.has("alice@example.com")).toBe(true);
    expect(out.emails.has("bob@example.com")).toBe(true);
    expect(out.emails.size).toBe(2);
  });

  it("rejects an empty allow-list", async () => {
    const exit = await Effect.runPromiseExit(
      allowedEmailsConfig.pipe(
        Effect.withConfigProvider(ConfigProvider.fromMap(new Map([["ALLOWED_EMAILS", ",  ,"]]))),
      ),
    );
    expect(exit._tag).toBe("Failure");
  });
});
