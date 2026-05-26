import { Effect, Exit, Redacted } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { exchangeAuthCode } from "./index.ts";

const params = {
  clientId: "1234.apps.googleusercontent.com",
  clientSecret: Redacted.make("GOCSPX-secret"),
  redirectUri: "https://mcp.example/oauth/google/callback",
  code: "google-code",
};

describe("exchangeAuthCode", () => {
  let originalFetch: typeof fetch;
  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("POSTs the auth-code grant and returns the id_token", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ id_token: "header.payload.sig" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const out = await Effect.runPromise(exchangeAuthCode(params));
    expect(out.id_token).toBe("header.payload.sig");
    const calls = fetchMock.mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    const call = calls[0] as unknown as readonly [unknown, RequestInit];
    expect(call[0]).toBe("https://oauth2.googleapis.com/token");
    const init = call[1];
    expect(init.method).toBe("POST");
    expect(String(init.body)).toContain("grant_type=authorization_code");
    expect(String(init.body)).toContain("code=google-code");
  });

  it("fails when Google returns a non-2xx", async () => {
    globalThis.fetch = (async () =>
      new Response("invalid_grant", { status: 400 })) as unknown as typeof fetch;
    const exit = await Effect.runPromiseExit(exchangeAuthCode(params));
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) expect(JSON.stringify(exit.cause)).toContain("returned 400");
  });

  it("fails when the response has no id_token", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ access_token: "a" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })) as unknown as typeof fetch;
    const exit = await Effect.runPromiseExit(exchangeAuthCode(params));
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) expect(JSON.stringify(exit.cause)).toContain("missing id_token");
  });
});
