import { Cause, Effect, Exit, Redacted } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Embedder } from "../Embedder";
import { OpenAIEmbedderLayer } from "./index.ts";

describe("OpenAIEmbedderLayer", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  const params = {
    modelName: "text-embedding-3-small" as const,
    dimensions: 384,
    apiKey: Redacted.make("sk-test"),
  };

  const runWith = <A, E>(eff: Effect.Effect<A, E, Embedder>) =>
    Effect.runPromise(
      eff.pipe(Effect.provide(OpenAIEmbedderLayer(params))) as Effect.Effect<A, E, never>,
    );

  const runExitWith = <A, E>(eff: Effect.Effect<A, E, Embedder>) =>
    Effect.runPromiseExit(
      eff.pipe(Effect.provide(OpenAIEmbedderLayer(params))) as Effect.Effect<A, E, never>,
    );

  const failureOf = <A, E>(exit: Exit.Exit<A, E>): E | undefined => {
    if (Exit.isSuccess(exit)) return undefined;
    const f = Cause.failureOption(exit.cause);
    return f._tag === "Some" ? f.value : undefined;
  };

  it("posts the configured model + dimensions and parses results in input order", async () => {
    const mockFetch = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: [
            { index: 1, embedding: new Array(384).fill(0).map((_, i) => (i === 0 ? 1 : 0)) },
            { index: 0, embedding: new Array(384).fill(0).map((_, i) => (i === 1 ? 1 : 0)) },
          ],
          model: "text-embedding-3-small",
        }),
        { status: 200 },
      ),
    );

    const result = await runWith(Effect.flatMap(Embedder, (e) => e.embed(["alpha", "beta"])));

    expect(result).toHaveLength(2);
    // input 0 → index 0 → embedding with 1 at position 1
    expect(result[0]?.[1]).toBeCloseTo(1, 5);
    expect(result[1]?.[0]).toBeCloseTo(1, 5);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const args = mockFetch.mock.calls[0] ?? [];
    expect(args[0]).toBe("https://api.openai.com/v1/embeddings");
    const body = JSON.parse(args[1].body);
    expect(body.model).toBe("text-embedding-3-small");
    expect(body.dimensions).toBe(384);
    expect(body.input).toEqual(["alpha", "beta"]);
  });

  it("fails with EmbeddingError on non-2xx", async () => {
    const mockFetch = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    mockFetch.mockResolvedValueOnce(new Response("rate limited", { status: 429 }));

    const exit = await runExitWith(Effect.flatMap(Embedder, (e) => e.embed(["x"])));
    const failure = failureOf(exit) as { _tag: string; status?: number } | undefined;
    expect(failure?._tag).toBe("EmbeddingError");
    expect(failure?.status).toBe(429);
  });

  it("fails when the response length does not match the input length", async () => {
    const mockFetch = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: [{ index: 0, embedding: new Array(384).fill(0.1) }],
          model: "text-embedding-3-small",
        }),
        { status: 200 },
      ),
    );

    const exit = await runExitWith(Effect.flatMap(Embedder, (e) => e.embed(["a", "b"])));
    const failure = failureOf(exit) as { _tag: string } | undefined;
    expect(failure?._tag).toBe("EmbeddingError");
  });

  it("returns the empty array for an empty input without hitting the API", async () => {
    const result = await runWith(Effect.flatMap(Embedder, (e) => e.embed([])));
    expect(result).toEqual([]);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
