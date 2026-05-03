import { describe, expect, it } from "vitest";
import { ConfigProvider, Effect, Redacted } from "effect";
import { oauthConfig } from "./index.ts";

describe("oauthConfig", () => {
  it("loads required fields and applies TTL defaults", async () => {
    const out = await Effect.runPromise(
      oauthConfig.pipe(
        Effect.withConfigProvider(
          ConfigProvider.fromMap(
            new Map([
              ["OAUTH_SIGNING_KEY", "-----BEGIN PRIVATE KEY-----\nFAKE\n-----END PRIVATE KEY-----\n"],
              ["OAUTH_ISSUER", "https://mcp.example"],
            ]),
          ),
        ),
      ),
    );
    expect(out.issuer).toBe("https://mcp.example");
    expect(Redacted.value(out.signingKeyPem)).toContain("BEGIN PRIVATE KEY");
    expect(out.accessTokenTtlSeconds).toBe(3600);
    expect(out.refreshTokenTtlSeconds).toBe(60 * 60 * 24 * 30);
    expect(out.authorizationCodeTtlSeconds).toBe(60);
    expect(out.googleStateTtlSeconds).toBe(600);
  });

  it("respects TTL overrides", async () => {
    const out = await Effect.runPromise(
      oauthConfig.pipe(
        Effect.withConfigProvider(
          ConfigProvider.fromMap(
            new Map([
              ["OAUTH_SIGNING_KEY", "k"],
              ["OAUTH_ISSUER", "https://mcp.example"],
              ["OAUTH_ACCESS_TOKEN_TTL_S", "120"],
              ["OAUTH_AUTHORIZATION_CODE_TTL_S", "30"],
            ]),
          ),
        ),
      ),
    );
    expect(out.accessTokenTtlSeconds).toBe(120);
    expect(out.authorizationCodeTtlSeconds).toBe(30);
  });
});
