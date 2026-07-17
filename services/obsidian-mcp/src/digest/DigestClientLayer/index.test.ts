import { Effect, Exit, Redacted } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DigestClient, type DigestClientImpl } from "../DigestClient";
import { DigestClientLayer } from "./index.ts";

const params = {
  apiKey: Redacted.make("sk-ant-test"),
  model: "claude-opus-4-8",
  timeoutMs: 30000,
};

const run = <A, E>(f: (client: DigestClientImpl) => Effect.Effect<A, E>) =>
  Effect.runPromiseExit(
    Effect.gen(function* () {
      const client = yield* DigestClient;
      return yield* f(client);
    }).pipe(Effect.provide(DigestClientLayer(params))),
  );

const apiMessage = (structured: unknown, stopReason = "end_turn") =>
  new Response(
    JSON.stringify({
      id: "msg_1",
      type: "message",
      role: "assistant",
      model: params.model,
      content: [{ type: "text", text: JSON.stringify(structured) }],
      stop_reason: stopReason,
      stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 10 },
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );

describe("DigestClientLayer", () => {
  let originalFetch: typeof fetch;
  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("digestTranscript returns the schema-validated digest", async () => {
    const digest = {
      todos: [{ text: "Send the deck to Alice", urgent: true }],
      people: [{ name: "Alice", facts: ["Cares about launch timelines"] }],
    };
    globalThis.fetch = vi.fn(async () => apiMessage(digest)) as unknown as typeof fetch;

    const exit = await run((c) =>
      c.digestTranscript({
        transcriptMarkdown: "# Weekly sync\n**Alice** (0:00): hi",
        participants: ["Alice", "Niranjan"],
        selfName: "Niranjan",
      }),
    );
    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) expect(exit.value).toEqual(digest);
  });

  it("mergeTodoList unwraps the markdown field", async () => {
    globalThis.fetch = vi.fn(async () =>
      apiMessage({ markdown: "# TODO\n\n- [ ] Send the deck" }),
    ) as unknown as typeof fetch;

    const exit = await run((c) =>
      c.mergeTodoList({
        existingMarkdown: "",
        todos: [{ text: "Send the deck", urgent: false }],
        date: "2026-07-02",
        meetingTitle: "Weekly sync",
        selfName: "Niranjan",
      }),
    );
    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) expect(exit.value).toContain("- [ ] Send the deck");
  });

  it("fails with DigestError when the response violates the schema", async () => {
    globalThis.fetch = vi.fn(async () =>
      apiMessage({ todos: [{ text: 42 }], people: [] }),
    ) as unknown as typeof fetch;

    const exit = await run((c) =>
      c.digestTranscript({ transcriptMarkdown: "x", participants: [], selfName: "Niranjan" }),
    );
    expect(Exit.isFailure(exit)).toBe(true);
  });

  it("fails with DigestError on a refusal stop reason", async () => {
    globalThis.fetch = vi.fn(async () =>
      apiMessage({ todos: [], people: [] }, "refusal"),
    ) as unknown as typeof fetch;

    const exit = await run((c) =>
      c.digestTranscript({ transcriptMarkdown: "x", participants: [], selfName: "Niranjan" }),
    );
    expect(Exit.isFailure(exit)).toBe(true);
  });
});
