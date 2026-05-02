import { describe, expect, it } from "vitest";
import { Effect, Layer, Redacted } from "effect";
import { CouchClientLayer } from "./index.ts";
import { CouchClient } from "../CouchClient";

describe("CouchClientLayer", () => {
  it("returns a Layer that resolves the CouchClient tag", async () => {
    const layer = CouchClientLayer({
      url: "http://example.invalid",
      database: "obsidian",
      username: "u",
      password: Redacted.make("p"),
    });
    expect(Layer.isLayer(layer)).toBe(true);

    const present = await Effect.runPromise(
      Effect.gen(function* () {
        const c = yield* CouchClient;
        return typeof c.getDoc === "function" && typeof c.raw === "function";
      }).pipe(Effect.provide(layer)),
    );
    expect(present).toBe(true);
  });
});
