import { describe, expect, it } from "vitest";
import { buildAuthUrl } from "./index.ts";

describe("buildAuthUrl", () => {
  it("includes all required Google OIDC params", () => {
    const url = new URL(
      buildAuthUrl({
        clientId: "1234.apps.googleusercontent.com",
        redirectUri: "https://mcp.example/oauth/google/callback",
        state: "opaque-state",
      }),
    );
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("client_id")).toBe("1234.apps.googleusercontent.com");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://mcp.example/oauth/google/callback",
    );
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("scope")).toBe("openid email");
    expect(url.searchParams.get("state")).toBe("opaque-state");
    expect(url.searchParams.get("prompt")).toBe("select_account");
  });

  it("threads login_hint through when provided", () => {
    const url = new URL(
      buildAuthUrl({
        clientId: "x",
        redirectUri: "https://mcp.example/cb",
        state: "s",
        loginHint: "user@example.com",
      }),
    );
    expect(url.searchParams.get("login_hint")).toBe("user@example.com");
  });

  it("omits login_hint when not provided", () => {
    const url = new URL(
      buildAuthUrl({
        clientId: "x",
        redirectUri: "https://mcp.example/cb",
        state: "s",
      }),
    );
    expect(url.searchParams.has("login_hint")).toBe(false);
  });
});
