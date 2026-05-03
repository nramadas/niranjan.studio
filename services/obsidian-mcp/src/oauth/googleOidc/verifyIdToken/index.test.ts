import { describe, expect, it } from "vitest";
import { Effect, Exit } from "effect";
import { verifyIdToken } from "./index.ts";

describe("verifyIdToken", () => {
  // Full verification requires Google's live JWKS and a Google-issued
  // token, which a unit test can't produce. We exercise the failure path
  // with a structurally-invalid token and assert the error mapping.
  it("maps verification failure to OAuthError(access_denied, 403)", async () => {
    const exit = await Effect.runPromiseExit(verifyIdToken("not.a.token", "audience"));
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      const text = JSON.stringify(exit.cause);
      expect(text).toContain("OAuthError");
      expect(text).toContain("access_denied");
      expect(text).toContain("403");
    }
  });
});
