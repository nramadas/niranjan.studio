import { describe, expect, it } from "vitest";
import { ConfigProvider, Effect, Redacted } from "effect";
import { googleOidcConfig } from "./index.ts";

describe("googleOidcConfig", () => {
  it("loads client id, secret, and redirect URI", async () => {
    const out = await Effect.runPromise(
      googleOidcConfig.pipe(
        Effect.withConfigProvider(
          ConfigProvider.fromMap(
            new Map([
              ["GOOGLE_OAUTH_CLIENT_ID", "1234.apps.googleusercontent.com"],
              ["GOOGLE_OAUTH_CLIENT_SECRET", "GOCSPX-secret"],
              ["GOOGLE_OAUTH_REDIRECT_URI", "https://mcp.example/oauth/google/callback"],
            ]),
          ),
        ),
      ),
    );
    expect(out.clientId).toBe("1234.apps.googleusercontent.com");
    expect(Redacted.value(out.clientSecret)).toBe("GOCSPX-secret");
    expect(out.redirectUri).toBe("https://mcp.example/oauth/google/callback");
  });
});
