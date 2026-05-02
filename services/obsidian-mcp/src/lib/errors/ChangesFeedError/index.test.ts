import { describe, expect, it } from "vitest";
import { ChangesFeedError } from "./index.ts";

describe("ChangesFeedError", () => {
  it("carries the tag and message", () => {
    const err = new ChangesFeedError({ message: "feed disconnected" });
    expect(err._tag).toBe("ChangesFeedError");
    expect(err.message).toBe("feed disconnected");
  });
});
