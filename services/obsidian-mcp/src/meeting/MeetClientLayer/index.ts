import { Effect, Layer, Redacted } from "effect";
import { GOOGLE_TOKEN_ENDPOINT } from "../../oauth/googleOidc/constants.ts";
import {
  type ConferenceRecordInfo,
  MeetClient,
  type MeetClientImpl,
  type MeetParticipant,
  type MeetTranscriptEntry,
} from "../MeetClient";
import { MEET_TRANSCRIPT_FILE_GENERATED } from "../constants.ts";
import { MeetApiError } from "../errors/MeetApiError";
import type { MeetAccount } from "../types.ts";

interface Params {
  /** Google OAuth Web-application client (same one the MCP OAuth flow uses). */
  readonly clientId: string;
  readonly clientSecret: Redacted.Redacted<string>;
  /**
   * The Google accounts whose Meet transcripts are ingested. Each carries a
   * refresh token (meetings.space.readonly scope) and the Workspace Events
   * target for its subscription. Parsed from MEET_ACCOUNTS_JSON by
   * `parseMeetAccounts`.
   */
  readonly accounts: ReadonlyArray<MeetAccount>;
  /** Pub/Sub topic events are published to: `projects/{p}/topics/{t}`. */
  readonly pubsubTopic: string;
  readonly timeoutMs: number;
  /** Overridable in tests; default the real Google hosts. */
  readonly meetApiBase?: string;
  readonly eventsApiBase?: string;
  readonly tokenEndpoint?: string;
}

// Defensive shapes for the slices of Google responses we read.
interface TokenResponse {
  readonly access_token?: string;
  readonly expires_in?: number;
}
interface EntriesPage {
  readonly transcriptEntries?: ReadonlyArray<{
    readonly participant?: string;
    readonly text?: string;
    readonly languageCode?: string;
    readonly startTime?: string;
    readonly endTime?: string;
  }>;
  readonly nextPageToken?: string;
}
interface ParticipantsPage {
  readonly participants?: ReadonlyArray<{
    readonly name?: string;
    readonly signedinUser?: { readonly displayName?: string };
    readonly anonymousUser?: { readonly displayName?: string };
    readonly phoneUser?: { readonly displayName?: string };
  }>;
  readonly nextPageToken?: string;
}
interface SubscriptionsPage {
  readonly subscriptions?: ReadonlyArray<{
    readonly name?: string;
    readonly state?: string;
  }>;
}

// Hard cap on pagination loops so a bad nextPageToken can't spin forever.
const MAX_PAGES = 50;

/**
 * Google Meet REST API + Workspace Events API client for a set of accounts.
 * Uses Node's built-in `fetch` with per-account bearers minted from each
 * account's refresh token (cached until shortly before expiry) and an
 * AbortController timeout. Every failure path produces a tagged
 * `MeetApiError`; addressing an unconfigured account name fails with
 * op "account".
 *
 * The base URLs are parameters (defaulting to the real Google hosts) so the
 * pagination, auth, and subscription logic is unit-testable against a
 * stubbed fetch.
 */
export const MeetClientLayer = (params: Params) => Layer.succeed(MeetClient, buildImpl(params));

const buildImpl = (params: Params): MeetClientImpl => {
  const meetBase = (params.meetApiBase ?? "https://meet.googleapis.com").replace(/\/+$/, "");
  const eventsBase = (params.eventsApiBase ?? "https://workspaceevents.googleapis.com").replace(
    /\/+$/,
    "",
  );
  const tokenEndpoint = params.tokenEndpoint ?? GOOGLE_TOKEN_ENDPOINT;

  const accountByName = new Map<string, MeetAccount>();
  for (const a of params.accounts) accountByName.set(a.name, a);

  // Per-account access-token cache. Google access tokens live ~1h; refresh
  // 60s early.
  const cached = new Map<string, { token: string; expiresAtMs: number }>();

  const lookupAccount = (account: string): Effect.Effect<MeetAccount, MeetApiError> => {
    const found = accountByName.get(account);
    return found
      ? Effect.succeed(found)
      : Effect.fail(
          new MeetApiError({
            op: "account",
            message: `unknown meet account "${account}" (configured: ${[...accountByName.keys()].join(", ") || "none"})`,
          }),
        );
  };

  const rawFetch = (
    op: string,
    url: string,
    init: RequestInit,
  ): Effect.Effect<Response, MeetApiError> =>
    Effect.gen(function* () {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), params.timeoutMs);
      return yield* Effect.tryPromise({
        try: () => fetch(url, { ...init, signal: controller.signal }),
        catch: (cause) => {
          const isAbort = cause instanceof Error && cause.name === "AbortError";
          return new MeetApiError({
            op,
            message: isAbort
              ? `google ${op} timed out after ${params.timeoutMs}ms`
              : `google ${op} network error: ${cause instanceof Error ? cause.message : String(cause)}`,
            cause,
          });
        },
      }).pipe(Effect.ensuring(Effect.sync(() => clearTimeout(timer))));
    });

  const readJson = (op: string, res: Response): Effect.Effect<unknown, MeetApiError> =>
    Effect.gen(function* () {
      const text = yield* Effect.promise(() => res.text().catch(() => ""));
      if (!res.ok) {
        return yield* Effect.fail(
          new MeetApiError({
            op,
            status: res.status,
            message: `google ${op} returned ${res.status}: ${text.slice(0, 300)}`,
          }),
        );
      }
      if (!text) return {};
      try {
        return JSON.parse(text) as unknown;
      } catch (cause) {
        return yield* Effect.fail(
          new MeetApiError({ op, message: `google ${op} returned a non-JSON body`, cause }),
        );
      }
    });

  const accessToken = (account: string): Effect.Effect<string, MeetApiError> =>
    Effect.gen(function* () {
      const hit = cached.get(account);
      if (hit && hit.expiresAtMs > Date.now()) return hit.token;
      const acct = yield* lookupAccount(account);
      const form = new URLSearchParams({
        client_id: params.clientId,
        client_secret: Redacted.value(params.clientSecret),
        refresh_token: Redacted.value(acct.refreshToken),
        grant_type: "refresh_token",
      });
      const res = yield* rawFetch(`refresh_token(${account})`, tokenEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: form.toString(),
      });
      const json = (yield* readJson(`refresh_token(${account})`, res)) as TokenResponse;
      if (typeof json.access_token !== "string" || json.access_token.length === 0) {
        return yield* Effect.fail(
          new MeetApiError({
            op: `refresh_token(${account})`,
            message: "google token response missing access_token",
          }),
        );
      }
      const ttlS = typeof json.expires_in === "number" ? json.expires_in : 3600;
      cached.set(account, {
        token: json.access_token,
        expiresAtMs: Date.now() + (ttlS - 60) * 1000,
      });
      return json.access_token;
    });

  const request = (
    account: string,
    op: string,
    method: string,
    url: string,
    body?: unknown,
  ): Effect.Effect<unknown, MeetApiError> =>
    Effect.gen(function* () {
      const token = yield* accessToken(account);
      const res = yield* rawFetch(op, url, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      // A 401 means the cached bearer died early (token revoked, password
      // change). Evict it so the next attempt — typically the Pub/Sub retry
      // of this very delivery — mints a fresh one instead of replaying the
      // dead token for up to an hour.
      return yield* readJson(op, res).pipe(
        Effect.tapError((e) =>
          Effect.sync(() => {
            if (e.status === 401) cached.delete(account);
          }),
        ),
      );
    });

  return {
    accounts: params.accounts.map((a) => ({ name: a.name, targetResource: a.targetResource })),

    getConferenceRecord: (account, name) =>
      Effect.gen(function* () {
        const json = (yield* request(
          account,
          "get_conference_record",
          "GET",
          `${meetBase}/v2/${name}`,
        )) as ConferenceRecordInfo;
        return {
          name,
          startTime: json.startTime,
          endTime: json.endTime,
          space: json.space,
        };
      }),

    listTranscriptEntries: (account, transcriptName) =>
      Effect.gen(function* () {
        const out: MeetTranscriptEntry[] = [];
        let pageToken: string | undefined;
        for (let page = 0; page < MAX_PAGES; page++) {
          const qs = new URLSearchParams({ pageSize: "100" });
          if (pageToken) qs.set("pageToken", pageToken);
          const json = (yield* request(
            account,
            "list_entries",
            "GET",
            `${meetBase}/v2/${transcriptName}/entries?${qs}`,
          )) as EntriesPage;
          for (const e of json.transcriptEntries ?? []) {
            const text = (e.text ?? "").trim();
            if (!text) continue;
            out.push({
              participant: e.participant,
              text,
              languageCode: e.languageCode,
              startTime: e.startTime,
              endTime: e.endTime,
            });
          }
          pageToken = json.nextPageToken;
          if (!pageToken) break;
        }
        if (pageToken) {
          // MAX_PAGES exists to stop a bad-token spin; a real transcript
          // this long must not be silently truncated.
          yield* Effect.logWarning(
            `google list_entries for ${transcriptName} truncated at ${MAX_PAGES} pages (${out.length} entries) — transcript is incomplete`,
          );
        }
        return out;
      }),

    listParticipants: (account, conferenceRecordName) =>
      Effect.gen(function* () {
        const out: MeetParticipant[] = [];
        let pageToken: string | undefined;
        for (let page = 0; page < MAX_PAGES; page++) {
          const qs = new URLSearchParams({ pageSize: "250" });
          if (pageToken) qs.set("pageToken", pageToken);
          const json = (yield* request(
            account,
            "list_participants",
            "GET",
            `${meetBase}/v2/${conferenceRecordName}/participants?${qs}`,
          )) as ParticipantsPage;
          for (const p of json.participants ?? []) {
            if (typeof p.name !== "string" || p.name.length === 0) continue;
            const displayName = (
              p.signedinUser?.displayName ??
              p.anonymousUser?.displayName ??
              p.phoneUser?.displayName ??
              ""
            ).trim();
            if (!displayName) continue;
            out.push({ name: p.name, displayName });
          }
          pageToken = json.nextPageToken;
          if (!pageToken) break;
        }
        if (pageToken) {
          yield* Effect.logWarning(
            `google list_participants for ${conferenceRecordName} truncated at ${MAX_PAGES} pages (${out.length} participants)`,
          );
        }
        return out;
      }),

    getSpaceMeetingCode: (account, spaceName) =>
      Effect.gen(function* () {
        const json = (yield* request(
          account,
          "get_space",
          "GET",
          `${meetBase}/v2/${spaceName}?fields=meetingCode`,
        )) as { meetingCode?: unknown };
        return typeof json.meetingCode === "string" && json.meetingCode.length > 0
          ? json.meetingCode
          : undefined;
      }),

    ensureSubscription: (account) =>
      Effect.gen(function* () {
        const acct = yield* lookupAccount(account);
        // The list filter is mandatory on this endpoint and must name both
        // the target resource and an event type.
        const filter = `event_types:"${MEET_TRANSCRIPT_FILE_GENERATED}" AND target_resource="${acct.targetResource}"`;
        const listed = (yield* request(
          account,
          "list_subscriptions",
          "GET",
          `${eventsBase}/v1/subscriptions?filter=${encodeURIComponent(filter)}`,
        )) as SubscriptionsPage;
        const existing = (listed.subscriptions ?? []).find(
          (s) => typeof s.name === "string" && s.state !== "DELETED",
        );

        if (!existing) {
          yield* request(account, "create_subscription", "POST", `${eventsBase}/v1/subscriptions`, {
            targetResource: acct.targetResource,
            eventTypes: [MEET_TRANSCRIPT_FILE_GENERATED],
            notificationEndpoint: { pubsubTopic: params.pubsubTopic },
            payloadOptions: { includeResource: false },
            // "0s" asks for the maximum TTL Google allows for this event type.
            ttl: "0s",
          });
          return { action: "created" as const };
        }

        if (existing.state === "SUSPENDED") {
          yield* request(
            account,
            "reactivate_subscription",
            "POST",
            `${eventsBase}/v1/${existing.name}:reactivate`,
            {},
          );
          return { action: "reactivated" as const };
        }

        yield* request(
          account,
          "renew_subscription",
          "PATCH",
          `${eventsBase}/v1/${existing.name}?updateMask=ttl`,
          { ttl: "0s" },
        );
        return { action: "renewed" as const };
      }),
  };
};
