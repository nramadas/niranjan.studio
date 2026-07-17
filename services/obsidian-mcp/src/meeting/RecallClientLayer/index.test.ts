import { Effect, Redacted } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RecallClient } from "../RecallClient";
import { RecallClientLayer } from "./index.ts";

const baseParams = {
  apiBase: "https://us-east-1.recall.ai",
  apiKey: Redacted.make("recall-key"),
  botName: "Niranjan's AI Assistant",
  recordingConfigJson: '{"audio_mixed_mp3":{}}',
  timeoutMs: 5000,
};

type Params = Parameters<typeof RecallClientLayer>[0];

const createBot = (params: Params) =>
  Effect.gen(function* () {
    const client = yield* RecallClient;
    return yield* client.createBot({ meetingUrl: "https://zoom.us/j/1", metadata: { a: "b" } });
  }).pipe(Effect.provide(RecallClientLayer(params)));

const bodyOf = (mock: ReturnType<typeof vi.fn>): Record<string, unknown> => {
  const init = mock.mock.calls[0]?.[1] as RequestInit;
  return JSON.parse(String(init.body)) as Record<string, unknown>;
};

describe("RecallClientLayer.createBot", () => {
  let originalFetch: typeof fetch;
  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  const okResponse = () =>
    vi.fn(
      async () =>
        new Response(JSON.stringify({ id: "bot_1" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );

  it("includes automatic_video_output when a bot image is provided", async () => {
    const fetchMock = okResponse();
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const out = await Effect.runPromise(createBot({ ...baseParams, botImageBase64: "AAAA" }));
    expect(out.id).toBe("bot_1");

    const body = bodyOf(fetchMock);
    expect(body.bot_name).toBe("Niranjan's AI Assistant");
    expect(body.automatic_video_output).toEqual({
      in_call_recording: { kind: "jpeg", b64_data: "AAAA" },
    });
  });

  it("omits automatic_video_output when no bot image is provided", async () => {
    const fetchMock = okResponse();
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await Effect.runPromise(createBot({ ...baseParams }));

    const body = bodyOf(fetchMock);
    expect(body.bot_name).toBe("Niranjan's AI Assistant");
    expect(body.automatic_video_output).toBeUndefined();
  });
});
