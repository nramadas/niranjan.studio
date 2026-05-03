import { describe, expect, it } from "vitest";
import { Data, Effect, Layer, ManagedRuntime } from "effect";
import { runTool } from "./index.ts";

class MyError extends Data.TaggedError("MyError")<{ readonly message: string }> {}

describe("runTool", () => {
  it("wraps a successful Effect into a tool result with structuredContent", async () => {
    const runtime = ManagedRuntime.make(Layer.empty);
    const inner = await runtime.runtime();
    const result = await runTool(inner, "test_tool")(Effect.succeed({ ok: true, n: 1 }));
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({ ok: true, n: 1 });
    expect(result.content[0]?.text).toContain("ok");
  });

  it("wraps an array result in an items envelope", async () => {
    const runtime = ManagedRuntime.make(Layer.empty);
    const inner = await runtime.runtime();
    const result = await runTool(inner, "test_tool")(Effect.succeed([1, 2, 3]));
    expect(result.structuredContent).toEqual({ items: [1, 2, 3] });
  });

  it("renders a tagged error as a structured isError result", async () => {
    const runtime = ManagedRuntime.make(Layer.empty);
    const inner = await runtime.runtime();
    const result = await runTool(inner, "test_tool")(Effect.fail(new MyError({ message: "kaboom" })));
    expect(result.isError).toBe(true);
    const payload = JSON.parse(result.content[0]?.text ?? "{}");
    expect(payload.tag).toBe("MyError");
    expect(payload.message).toBe("kaboom");
  });

  it("renders a non-tagged error as Unknown", async () => {
    const runtime = ManagedRuntime.make(Layer.empty);
    const inner = await runtime.runtime();
    const result = await runTool(inner, "test_tool")(Effect.die(new Error("boom")));
    expect(result.isError).toBe(true);
    const payload = JSON.parse(result.content[0]?.text ?? "{}");
    expect(payload.tag).toBe("Unknown");
  });
});
