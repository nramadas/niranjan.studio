import { describe, expect, it } from "vitest";
import { Effect, Exit } from "effect";
import { handleRegister } from "./index.ts";

describe("handleRegister", () => {
  it("returns a stable client_id derived from the metadata", async () => {
    const body = {
      client_name: "Claude",
      redirect_uris: ["https://claude.ai/api/mcp/auth_callback"],
      token_endpoint_auth_method: "none",
    };
    const a = await Effect.runPromise(handleRegister(body));
    const b = await Effect.runPromise(handleRegister(body));
    expect(a.kind).toBe("json");
    if (a.kind === "json" && b.kind === "json") {
      const ra = a.body as { client_id: string };
      const rb = b.body as { client_id: string };
      expect(ra.client_id).toBe(rb.client_id);
      expect(a.status).toBe(201);
    }
  });

  it("rejects a missing or empty redirect_uris", async () => {
    const exit = await Effect.runPromiseExit(handleRegister({}));
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) expect(JSON.stringify(exit.cause)).toContain("redirect_uris must be a non-empty array");
  });

  it("rejects a non-https redirect_uri (except localhost)", async () => {
    const exit = await Effect.runPromiseExit(
      handleRegister({ redirect_uris: ["http://example.com/cb"] }),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) expect(JSON.stringify(exit.cause)).toContain("https");
  });

  it("accepts http://localhost for dev clients", async () => {
    const out = await Effect.runPromise(
      handleRegister({ redirect_uris: ["http://localhost:3000/cb"] }),
    );
    expect(out.kind).toBe("json");
  });

  it("rejects token_endpoint_auth_method other than none", async () => {
    const exit = await Effect.runPromiseExit(
      handleRegister({
        redirect_uris: ["https://x.example/cb"],
        token_endpoint_auth_method: "client_secret_basic",
      }),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) expect(JSON.stringify(exit.cause)).toContain("public clients");
  });
});
