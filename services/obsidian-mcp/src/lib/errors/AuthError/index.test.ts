import { describe, expect, it } from "vitest";
import { AuthError } from "./index.ts";

describe("AuthError", () => {
  it("carries the tag, reason, and statusCode", () => {
    const err = new AuthError({ reason: "missing header", statusCode: 401 });
    expect(err._tag).toBe("AuthError");
    expect(err.statusCode).toBe(401);
    expect(err.reason).toBe("missing header");
  });

  it("accepts statusCode 403", () => {
    const err = new AuthError({ reason: "bad token", statusCode: 403 });
    expect(err.statusCode).toBe(403);
  });
});
