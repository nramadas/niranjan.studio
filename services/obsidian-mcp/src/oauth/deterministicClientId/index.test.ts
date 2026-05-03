import { describe, expect, it } from "vitest";
import { deterministicClientId } from "./index.ts";

describe("deterministicClientId", () => {
  it("returns the same id for the same metadata", () => {
    const m = {
      client_name: "Claude",
      redirect_uris: ["https://claude.ai/api/mcp/auth_callback"],
      grant_types: ["authorization_code", "refresh_token"],
      token_endpoint_auth_method: "none",
    };
    expect(deterministicClientId(m)).toBe(deterministicClientId(m));
  });

  it("ignores redirect_uri ordering", () => {
    const a = deterministicClientId({
      redirect_uris: ["https://a.example/cb", "https://b.example/cb"],
    });
    const b = deterministicClientId({
      redirect_uris: ["https://b.example/cb", "https://a.example/cb"],
    });
    expect(a).toBe(b);
  });

  it("changes when redirect_uris differ", () => {
    const a = deterministicClientId({ redirect_uris: ["https://a.example/cb"] });
    const b = deterministicClientId({ redirect_uris: ["https://b.example/cb"] });
    expect(a).not.toBe(b);
  });

  it("emits URL-safe base64 (no +, /, =)", () => {
    const id = deterministicClientId({ redirect_uris: ["https://x.example/cb"] });
    expect(id).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});
