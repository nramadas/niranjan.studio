import { Effect, Exit, Redacted } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MeetClient, type MeetClientImpl } from "../MeetClient";
import { MeetClientLayer } from "./index.ts";

const baseParams = {
  clientId: "client-id",
  clientSecret: Redacted.make("client-secret"),
  accounts: [
    {
      name: "personal",
      refreshToken: Redacted.make("refresh-personal"),
      targetResource: "//cloudidentity.googleapis.com/users/111",
    },
    {
      name: "work",
      refreshToken: Redacted.make("refresh-work"),
      targetResource: "//cloudidentity.googleapis.com/users/222",
    },
  ],
  pubsubTopic: "projects/p/topics/meet-events",
  timeoutMs: 5000,
};

const run = <A>(f: (client: MeetClientImpl) => Effect.Effect<A, unknown>) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const client = yield* MeetClient;
      return yield* f(client);
    }).pipe(Effect.provide(MeetClientLayer(baseParams))) as Effect.Effect<A, never>,
  );

const runExit = <A>(f: (client: MeetClientImpl) => Effect.Effect<A, unknown>) =>
  Effect.runPromiseExit(
    Effect.gen(function* () {
      const client = yield* MeetClient;
      return yield* f(client);
    }).pipe(Effect.provide(MeetClientLayer(baseParams))),
  );

const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

// One bearer per refresh token so tests can assert which account made a call.
const tokenResponse = (init?: RequestInit) => {
  const form = new URLSearchParams(String(init?.body));
  const refresh = form.get("refresh_token") ?? "unknown";
  return json({ access_token: `at-${refresh}`, expires_in: 3600 });
};

describe("MeetClientLayer", () => {
  let originalFetch: typeof fetch;
  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("exposes the configured accounts without secrets", async () => {
    const accounts = await run((c) => Effect.succeed(c.accounts));
    expect(accounts).toEqual([
      { name: "personal", targetResource: "//cloudidentity.googleapis.com/users/111" },
      { name: "work", targetResource: "//cloudidentity.googleapis.com/users/222" },
    ]);
  });

  it("mints one bearer per account and caches each independently", async () => {
    const tokenBodies: string[] = [];
    const bearers: string[] = [];
    globalThis.fetch = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const u = String(url);
      if (u.includes("oauth2.googleapis.com/token")) {
        tokenBodies.push(String(init?.body));
        return tokenResponse(init);
      }
      bearers.push((init?.headers as Record<string, string>).Authorization ?? "");
      return json({ startTime: "2026-07-01T14:00:00Z" });
    }) as unknown as typeof fetch;

    await run((c) =>
      Effect.all([
        c.getConferenceRecord("personal", "conferenceRecords/cr1"),
        c.getConferenceRecord("work", "conferenceRecords/cr1"),
        c.getConferenceRecord("personal", "conferenceRecords/cr2"),
      ]),
    );

    // Two token mints (one per account), not three.
    expect(tokenBodies).toHaveLength(2);
    expect(tokenBodies[0]).toContain("refresh_token=refresh-personal");
    expect(tokenBodies[1]).toContain("refresh_token=refresh-work");
    expect(bearers).toEqual([
      "Bearer at-refresh-personal",
      "Bearer at-refresh-work",
      "Bearer at-refresh-personal",
    ]);
  });

  it("fails with a tagged error for an unconfigured account", async () => {
    globalThis.fetch = vi.fn(async () => json({})) as unknown as typeof fetch;
    const exit = await runExit((c) => c.getConferenceRecord("nobody", "conferenceRecords/cr1"));
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      const cause = JSON.stringify(exit.cause);
      expect(cause).toContain("unknown meet account");
      expect(cause).toContain("nobody");
    }
  });

  it("follows pagination when listing transcript entries", async () => {
    globalThis.fetch = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const u = String(url);
      if (u.includes("/token")) return tokenResponse(init);
      if (u.includes("pageToken=next-1")) {
        return json({
          transcriptEntries: [{ participant: "p2", text: "second page" }],
        });
      }
      return json({
        transcriptEntries: [
          { participant: "p1", text: "first page", startTime: "2026-07-01T14:00:05Z" },
          { participant: "p1", text: "   " }, // blank text is dropped
        ],
        nextPageToken: "next-1",
      });
    }) as unknown as typeof fetch;

    const entries = await run((c) =>
      c.listTranscriptEntries("work", "conferenceRecords/cr1/transcripts/t1"),
    );
    expect(entries.map((e) => e.text)).toEqual(["first page", "second page"]);
  });

  it("resolves participant display names across user kinds", async () => {
    globalThis.fetch = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const u = String(url);
      if (u.includes("/token")) return tokenResponse(init);
      return json({
        participants: [
          { name: "conferenceRecords/cr1/participants/1", signedinUser: { displayName: "Alice" } },
          { name: "conferenceRecords/cr1/participants/2", anonymousUser: { displayName: "Bob" } },
          { name: "conferenceRecords/cr1/participants/3", phoneUser: { displayName: "Carol" } },
          { name: "conferenceRecords/cr1/participants/4" }, // no name → dropped
        ],
      });
    }) as unknown as typeof fetch;

    const participants = await run((c) => c.listParticipants("personal", "conferenceRecords/cr1"));
    expect(participants.map((p) => p.displayName)).toEqual(["Alice", "Bob", "Carol"]);
  });

  it("creates a subscription scoped to the requested account's target", async () => {
    const posts: Array<{ url: string; body: Record<string, unknown> }> = [];
    const listFilters: string[] = [];
    globalThis.fetch = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const u = String(url);
      if (u.includes("/token")) return tokenResponse(init);
      if (init?.method === "POST") {
        posts.push({ url: u, body: JSON.parse(String(init.body)) as Record<string, unknown> });
        return json({ name: "operations/op1" });
      }
      listFilters.push(decodeURIComponent(u.split("filter=")[1] ?? ""));
      return json({ subscriptions: [] });
    }) as unknown as typeof fetch;

    const out = await run((c) => c.ensureSubscription("work"));
    expect(out.action).toBe("created");
    expect(listFilters[0]).toContain('target_resource="//cloudidentity.googleapis.com/users/222"');
    expect(posts).toHaveLength(1);
    expect(posts[0]?.body.targetResource).toBe("//cloudidentity.googleapis.com/users/222");
    expect(posts[0]?.body.notificationEndpoint).toEqual({
      pubsubTopic: baseParams.pubsubTopic,
    });
  });

  it("renews an active subscription and reactivates a suspended one", async () => {
    let state = "ACTIVE";
    const ops: string[] = [];
    globalThis.fetch = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const u = String(url);
      if (u.includes("/token")) return tokenResponse(init);
      if (init?.method === "PATCH") {
        ops.push(`patch ${u}`);
        return json({});
      }
      if (init?.method === "POST") {
        ops.push(`post ${u}`);
        return json({});
      }
      return json({ subscriptions: [{ name: "subscriptions/s1", state }] });
    }) as unknown as typeof fetch;

    const renewed = await run((c) => c.ensureSubscription("personal"));
    expect(renewed.action).toBe("renewed");
    expect(ops[0]).toContain("patch");
    expect(ops[0]).toContain("subscriptions/s1?updateMask=ttl");

    state = "SUSPENDED";
    const reactivated = await run((c) => c.ensureSubscription("personal"));
    expect(reactivated.action).toBe("reactivated");
    expect(ops[1]).toContain("subscriptions/s1:reactivate");
  });
});
