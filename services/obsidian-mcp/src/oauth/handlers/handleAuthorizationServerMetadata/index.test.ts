import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import { handleAuthorizationServerMetadata } from "./index.ts";

describe("handleAuthorizationServerMetadata", () => {
  it("returns RFC 8414 metadata derived from the issuer", async () => {
    const out = await Effect.runPromise(
      handleAuthorizationServerMetadata("https://mcp.example"),
    );
    expect(out.kind).toBe("json");
    if (out.kind === "json") {
      const body = out.body as Record<string, unknown>;
      expect(body.issuer).toBe("https://mcp.example");
      expect(body.authorization_endpoint).toBe("https://mcp.example/authorize");
      expect(body.token_endpoint).toBe("https://mcp.example/token");
      expect(body.registration_endpoint).toBe("https://mcp.example/register");
      expect(body.jwks_uri).toBe("https://mcp.example/.well-known/jwks.json");
      expect(body.code_challenge_methods_supported).toEqual(["S256"]);
      expect(body.token_endpoint_auth_methods_supported).toEqual(["none"]);
    }
  });
});
