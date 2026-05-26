import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { handleProtectedResourceMetadata } from "./index.ts";

describe("handleProtectedResourceMetadata", () => {
  it("returns RFC 9728 metadata pointing at this server as the AS", async () => {
    const out = await Effect.runPromise(handleProtectedResourceMetadata("https://mcp.example"));
    expect(out.kind).toBe("json");
    if (out.kind === "json") {
      const body = out.body as Record<string, unknown>;
      expect(body.resource).toBe("https://mcp.example");
      expect(body.authorization_servers).toEqual(["https://mcp.example"]);
    }
  });
});
