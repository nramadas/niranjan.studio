import { describe, expect, it } from "vitest";
import { OAuthError } from "./index.ts";

describe("OAuthError", () => {
  it("carries the tag, code, description, and statusCode", () => {
    const err = new OAuthError({
      code: "invalid_grant",
      description: "code expired",
      statusCode: 400,
    });
    expect(err._tag).toBe("OAuthError");
    expect(err.code).toBe("invalid_grant");
    expect(err.description).toBe("code expired");
    expect(err.statusCode).toBe(400);
  });

  it("accepts each defined OAuth error code", () => {
    const codes = [
      "invalid_request",
      "invalid_client",
      "invalid_grant",
      "unauthorized_client",
      "unsupported_grant_type",
      "invalid_scope",
      "access_denied",
      "server_error",
      "invalid_redirect_uri",
      "invalid_client_metadata",
    ] as const;
    for (const code of codes) {
      const err = new OAuthError({ code, description: "x", statusCode: 400 });
      expect(err.code).toBe(code);
    }
  });
});
