import { describe, expect, it } from "vitest";
import { ConfigProvider, Effect } from "effect";
import { cloudflareAccessConfig } from "./index.ts";

describe("cloudflareAccessConfig", () => {
  it("loads team domain and AUD", async () => {
    const out = await Effect.runPromise(
      cloudflareAccessConfig.pipe(
        Effect.withConfigProvider(
          ConfigProvider.fromMap(
            new Map([
              ["CF_ACCESS_TEAM_DOMAIN", "team.cloudflareaccess.com"],
              ["CF_ACCESS_AUD", "abcdef0123456789"],
            ]),
          ),
        ),
      ),
    );
    expect(out.teamDomain).toBe("team.cloudflareaccess.com");
    expect(out.aud).toBe("abcdef0123456789");
  });
});
