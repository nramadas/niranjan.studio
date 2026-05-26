import { describe, expect, it } from "vitest";
import { CouchDbError } from "./index.ts";

describe("CouchDbError", () => {
  it("carries the tag, op, and message", () => {
    const err = new CouchDbError({ op: "getDoc", message: "not found", status: 404 });
    expect(err._tag).toBe("CouchDbError");
    expect(err.op).toBe("getDoc");
    expect(err.status).toBe(404);
    expect(err.message).toBe("not found");
  });

  it("allows omitting the status", () => {
    const err = new CouchDbError({ op: "putDoc", message: "transport failure" });
    expect(err.status).toBeUndefined();
  });
});
