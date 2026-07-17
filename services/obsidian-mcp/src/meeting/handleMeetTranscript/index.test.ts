import { Vault, type VaultImpl } from "@niranjan/vault-shared/couchdb";
import { NoteConflictError, NoteNotFoundError } from "@niranjan/vault-shared/lib/errors";
import { Effect, Exit, Layer, ManagedRuntime } from "effect";
import { describe, expect, it } from "vitest";
import { DigestClient, type DigestClientImpl } from "../../digest";
import { MeetClient, type MeetClientImpl } from "../MeetClient";
import { MeetApiError } from "../errors/MeetApiError";
import { handleMeetTranscript } from "./index.ts";

interface Calls {
  created?: string;
  body?: string;
  frontmatter?: Record<string, unknown>;
  updatedBody?: string;
  updatedFrontmatter?: Record<string, unknown>;
  digested: boolean;
  digestedMarkdown?: string;
  todoWritten: boolean;
  recordReads: string[];
}

const ACCOUNTS = [
  { name: "personal", targetResource: "//cloudidentity.googleapis.com/users/111" },
  { name: "work", targetResource: "//cloudidentity.googleapis.com/users/222" },
];

const setup = (opts: {
  /** Existing Meetings-note: body + frontmatter served by readNote. */
  existingNote?: { body: string; frontmatter: Record<string, unknown> };
  createConflicts?: boolean;
  meetingCode?: string;
  entries?: ReadonlyArray<{ participant?: string; text: string; startTime?: string }>;
  digestFails?: boolean;
  /** Accounts whose getConferenceRecord fails, mapped to a MeetApiError. */
  deniedAccounts?: Record<string, MeetApiError>;
}) => {
  const calls: Calls = { digested: false, todoWritten: false, recordReads: [] };

  const vault: VaultImpl = {
    listNotes: () => Effect.succeed([]),
    listRecent: () => Effect.succeed([]),
    readNote: ((path: string) =>
      opts.existingNote && path.startsWith("Meetings/")
        ? Effect.succeed({ path, ...opts.existingNote })
        : Effect.fail(new NoteNotFoundError({ path }))) as never,
    readNoteById: () => Effect.fail(new Error("stub")) as never,
    createNote: ((path: string, body: string, frontmatter: Record<string, unknown>) => {
      if (path === "TODO.md") {
        calls.todoWritten = true;
        return Effect.succeed({ path });
      }
      if (path.startsWith("Meetings/")) {
        if (opts.createConflicts) {
          return Effect.fail(new NoteConflictError({ path, message: "already created" }));
        }
        calls.created = path;
        calls.body = body;
        calls.frontmatter = frontmatter;
      }
      return Effect.succeed({ path });
    }) as never,
    readAllForIndex: () => Effect.succeed([]),
    updateNote: ((path: string, body: string, frontmatter: Record<string, unknown>) => {
      if (path.startsWith("Meetings/")) {
        calls.updatedBody = body;
        calls.updatedFrontmatter = frontmatter;
      }
      return Effect.succeed({ path });
    }) as never,
    appendToNote: () => Effect.succeed({} as never),
    editNote: () => Effect.succeed({} as never),
    deleteNote: () => Effect.void,
  };

  const meet: MeetClientImpl = {
    accounts: ACCOUNTS,
    getConferenceRecord: (account, name) => {
      calls.recordReads.push(account);
      const denied = opts.deniedAccounts?.[account];
      if (denied) return Effect.fail(denied);
      return Effect.succeed({
        name,
        startTime: "2026-07-01T14:00:00Z",
        endTime: "2026-07-01T14:30:00Z",
        space: "spaces/sp1",
      });
    },
    getSpaceMeetingCode: () => Effect.succeed(opts.meetingCode),
    listTranscriptEntries: () =>
      Effect.succeed(
        (opts.entries ?? [
          {
            participant: "conferenceRecords/cr1/participants/p1",
            text: "Let's ship it this week",
            startTime: "2026-07-01T14:00:05Z",
          },
        ]) as never,
      ),
    listParticipants: () =>
      Effect.succeed([
        { name: "conferenceRecords/cr1/participants/p1", displayName: "Alice" },
        { name: "conferenceRecords/cr1/participants/p2", displayName: "Niranjan Ramadas" },
      ]),
    ensureSubscription: () => Effect.succeed({ action: "renewed" as const }),
  };

  const digestClient: DigestClientImpl = {
    digestTranscript: (input) => {
      calls.digested = true;
      calls.digestedMarkdown = input.transcriptMarkdown;
      return opts.digestFails
        ? (Effect.fail(new Error("digest boom")) as never)
        : Effect.succeed({
            todos: [{ text: "Ship it", urgent: true }],
            people: [{ name: "Alice", facts: ["Wants to ship this week"] }],
          });
    },
    mergeTodoList: () => Effect.succeed("# TODO\n\n- [ ] Ship it"),
  };

  const layer = Layer.mergeAll(
    Layer.succeed(Vault, vault),
    Layer.succeed(MeetClient, meet),
    Layer.succeed(DigestClient, digestClient),
  );
  return { layer, calls };
};

const denied = (status: number, op = "get_conference_record") =>
  new MeetApiError({ op, status, message: `google ${op} returned ${status}` });

const baseInput = {
  transcriptName: "conferenceRecords/cr1/transcripts/t1",
  folder: "Meetings",
  digest: { todoNotePath: "TODO.md", peopleFolder: "People", selfName: "Niranjan" },
};

// Stable path: conference-record id + start time; never the meeting code.
const EXPECTED_PATH = "Meetings/2026-07-01 — Google Meet cr1 1400.md";

describe("handleMeetTranscript", () => {
  it("writes the transcript note with meet frontmatter and named speakers", async () => {
    const { layer, calls } = setup({ meetingCode: "abc-defg-hij" });
    const runtime = ManagedRuntime.make(layer);
    const exit = await runtime.runPromiseExit(handleMeetTranscript(baseInput));

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      expect(exit.value.notePath).toBe(EXPECTED_PATH);
      expect(exit.value.segments).toBe(1);
      expect(exit.value.account).toBe("personal");
      expect(exit.value.todosMerged).toBe(1);
      expect(exit.value.dossiersUpdated).toBe(1);
    }
    expect(calls.body).toContain("**Alice** (0:05): Let's ship it this week");
    expect(calls.frontmatter?.source).toBe("google-meet");
    expect(calls.frontmatter?.conference_record).toBe("conferenceRecords/cr1");
    expect(calls.frontmatter?.transcripts).toEqual(["conferenceRecords/cr1/transcripts/t1"]);
    expect(calls.frontmatter?.meeting_code).toBe("abc-defg-hij");
    expect(calls.frontmatter?.account).toBe("personal");
    expect(calls.frontmatter?.bot_id).toBeUndefined();
    expect(calls.frontmatter?.duration_min).toBe(30);
    expect(calls.todoWritten).toBe(true);
  });

  it("keeps the path stable when the meeting code is unreadable", async () => {
    const { layer, calls } = setup({});
    const runtime = ManagedRuntime.make(layer);
    await runtime.runPromise(handleMeetTranscript(baseInput));
    expect(calls.created).toBe(EXPECTED_PATH);
    expect(calls.frontmatter?.meeting_code).toBeUndefined();
  });

  it("tries the hinted account first", async () => {
    const { layer, calls } = setup({});
    const runtime = ManagedRuntime.make(layer);
    const exit = await runtime.runPromiseExit(
      handleMeetTranscript({
        ...baseInput,
        targetHint: "//cloudidentity.googleapis.com/users/222",
      }),
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) expect(exit.value.account).toBe("work");
    expect(calls.recordReads).toEqual(["work"]);
    expect(calls.frontmatter?.account).toBe("work");
  });

  it("falls back to configured-order probing when the hint matches no account", async () => {
    const { layer, calls } = setup({});
    const runtime = ManagedRuntime.make(layer);
    const exit = await runtime.runPromiseExit(
      handleMeetTranscript({
        ...baseInput,
        targetHint: "//meet.googleapis.com/spaces/unknown",
      }),
    );
    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) expect(exit.value.account).toBe("personal");
    expect(calls.recordReads).toEqual(["personal"]);
  });

  it("falls back to the next account when one cannot read the meeting", async () => {
    const { layer, calls } = setup({ deniedAccounts: { personal: denied(403) } });
    const runtime = ManagedRuntime.make(layer);
    const exit = await runtime.runPromiseExit(handleMeetTranscript(baseInput));

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) expect(exit.value.account).toBe("work");
    expect(calls.recordReads).toEqual(["personal", "work"]);
  });

  it("skips an account whose refresh token is revoked instead of failing the webhook", async () => {
    const { layer, calls } = setup({
      deniedAccounts: { personal: denied(400, "refresh_token(personal)") },
    });
    const runtime = ManagedRuntime.make(layer);
    const exit = await runtime.runPromiseExit(handleMeetTranscript(baseInput));

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) expect(exit.value.account).toBe("work");
    expect(calls.recordReads).toEqual(["personal", "work"]);
  });

  it("acks with a skip when no account can read the meeting", async () => {
    const { layer, calls } = setup({
      deniedAccounts: { personal: denied(404), work: denied(403) },
    });
    const runtime = ManagedRuntime.make(layer);
    const exit = await runtime.runPromiseExit(handleMeetTranscript(baseInput));

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) expect(exit.value.skipped).toBe("no-account-access");
    expect(calls.created).toBeUndefined();
    expect(calls.digested).toBe(false);
  });

  it("fails (so Pub/Sub retries) on a non-permission error", async () => {
    const { layer } = setup({ deniedAccounts: { personal: denied(500) } });
    const runtime = ManagedRuntime.make(layer);
    const exit = await runtime.runPromiseExit(handleMeetTranscript(baseInput));
    expect(Exit.isFailure(exit)).toBe(true);
  });

  it("skips a transcript that is already folded into the note", async () => {
    const { layer, calls } = setup({
      existingNote: {
        body: "# Google Meet cr1 1400",
        frontmatter: { transcripts: ["conferenceRecords/cr1/transcripts/t1"] },
      },
    });
    const runtime = ManagedRuntime.make(layer);
    const exit = await runtime.runPromiseExit(handleMeetTranscript(baseInput));

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) expect(exit.value.skipped).toBe("already-exists");
    expect(calls.created).toBeUndefined();
    expect(calls.updatedBody).toBeUndefined();
    expect(calls.digested).toBe(false);
  });

  it("treats a note without transcript provenance as already ingested", async () => {
    const { layer, calls } = setup({
      existingNote: { body: "# Hand-written note", frontmatter: {} },
    });
    const runtime = ManagedRuntime.make(layer);
    const exit = await runtime.runPromiseExit(handleMeetTranscript(baseInput));

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) expect(exit.value.skipped).toBe("already-exists");
    expect(calls.updatedBody).toBeUndefined();
    expect(calls.digested).toBe(false);
  });

  it("appends a new transcript of the same conference as a continuation", async () => {
    const { layer, calls } = setup({
      existingNote: {
        body: "# Google Meet cr1 1400\n\n**Alice** (0:01): earlier part\n",
        frontmatter: { transcripts: ["conferenceRecords/cr1/transcripts/t0"] },
      },
    });
    const runtime = ManagedRuntime.make(layer);
    const exit = await runtime.runPromiseExit(handleMeetTranscript(baseInput));

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      expect(exit.value.continued).toBe(true);
      expect(exit.value.segments).toBe(1);
    }
    expect(calls.created).toBeUndefined();
    expect(calls.updatedBody).toContain("**Alice** (0:01): earlier part");
    expect(calls.updatedBody).toContain("## Transcript (continued)");
    expect(calls.updatedBody).toContain("**Alice** (0:05): Let's ship it this week");
    expect(calls.updatedFrontmatter?.transcripts).toEqual([
      "conferenceRecords/cr1/transcripts/t0",
      "conferenceRecords/cr1/transcripts/t1",
    ]);
    // Digest sees only the continuation, not the whole re-read note.
    expect(calls.digested).toBe(true);
    expect(calls.digestedMarkdown).toContain("## Transcript (continued)");
    expect(calls.digestedMarkdown).not.toContain("earlier part");
  });

  it("fails (so Pub/Sub retries) when a concurrent delivery wins the create race", async () => {
    const { layer, calls } = setup({ createConflicts: true });
    const runtime = ManagedRuntime.make(layer);
    const exit = await runtime.runPromiseExit(handleMeetTranscript(baseInput));
    expect(Exit.isFailure(exit)).toBe(true);
    expect(calls.digested).toBe(false);
  });

  it("skips digestion when not configured", async () => {
    const { layer, calls } = setup({});
    const runtime = ManagedRuntime.make(layer);
    const exit = await runtime.runPromiseExit(
      handleMeetTranscript({ ...baseInput, digest: undefined }),
    );
    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) expect(exit.value.todosMerged).toBeUndefined();
    expect(calls.digested).toBe(false);
    expect(calls.created).toBeDefined();
  });

  it("still succeeds when digestion fails (best-effort)", async () => {
    const { layer, calls } = setup({ digestFails: true });
    const runtime = ManagedRuntime.make(layer);
    const exit = await runtime.runPromiseExit(handleMeetTranscript(baseInput));

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      expect(exit.value.segments).toBe(1);
      expect(exit.value.todosMerged).toBeUndefined();
    }
    expect(calls.created).toBeDefined();
  });

  it("ignores a malformed transcript name", async () => {
    const { layer, calls } = setup({});
    const runtime = ManagedRuntime.make(layer);
    const exit = await runtime.runPromiseExit(
      handleMeetTranscript({ ...baseInput, transcriptName: "garbage" }),
    );
    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) expect(exit.value.skipped).toBe("bad-transcript-name");
    expect(calls.created).toBeUndefined();
  });
});
