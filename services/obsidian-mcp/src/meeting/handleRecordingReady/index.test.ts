import { Vault, type VaultImpl } from "@niranjan/vault-shared/couchdb";
import { NoteNotFoundError } from "@niranjan/vault-shared/lib/errors";
import { Effect, Exit, Layer, ManagedRuntime } from "effect";
import { describe, expect, it } from "vitest";
import { RecallClient, type RecallClientImpl } from "../RecallClient";
import { TranscriptionClient, type TranscriptionClientImpl } from "../TranscriptionClient";
import { handleRecordingReady } from "./index.ts";

interface Calls {
  transcribed: boolean;
  created?: string;
  deleted: boolean;
}

const setup = (opts: { noteExists: boolean; audioUrl?: string }) => {
  const calls: Calls = { transcribed: false, deleted: false };

  const vault: VaultImpl = {
    listNotes: () => Effect.succeed([]),
    listRecent: () => Effect.succeed([]),
    readNote: (path: string) =>
      (opts.noteExists
        ? Effect.succeed({ path })
        : Effect.fail(new NoteNotFoundError({ path }))) as never,
    readNoteById: () => Effect.fail(new Error("stub")) as never,
    readAllForIndex: () => Effect.succeed([]),
    createNote: ((path: string) => {
      calls.created = path;
      return Effect.succeed({ path });
    }) as never,
    updateNote: () => Effect.succeed({} as never),
    appendToNote: () => Effect.succeed({} as never),
    editNote: () => Effect.succeed({} as never),
    deleteNote: () => Effect.void,
  };

  const recall: RecallClientImpl = {
    createBot: () => Effect.succeed({ id: "stub" }),
    getBot: () => Effect.succeed({ id: "stub" }),
    leaveCall: () => Effect.void,
    getRecording: () =>
      Effect.succeed({
        audioUrl: opts.audioUrl,
        participants: ["Alice", "Bob"],
        platform: "google_meet",
      }),
    deleteMedia: () => {
      calls.deleted = true;
      return Effect.void;
    },
  };

  const transcription: TranscriptionClientImpl = {
    transcribe: () => {
      calls.transcribed = true;
      return Effect.succeed({
        segments: [{ speaker: 0, start: 0, end: 2, text: "Hi" }],
        modelName: "deepgram-nova-3",
        durationSec: 2,
      });
    },
  };

  const layer = Layer.mergeAll(
    Layer.succeed(Vault, vault),
    Layer.succeed(RecallClient, recall),
    Layer.succeed(TranscriptionClient, transcription),
  );
  return { layer, calls };
};

const baseInput = {
  botId: "bot-12345678",
  noteTitle: "Standup",
  startedAt: "2026-06-18T14:00:00Z",
  folder: "Meetings",
  date: "2026-06-18",
};

describe("handleRecordingReady", () => {
  it("skips (no transcription, no delete) when a transcript note already exists", async () => {
    const { layer, calls } = setup({ noteExists: true, audioUrl: "https://x/a.mp3" });
    const exit = await ManagedRuntime.make(layer).runPromiseExit(handleRecordingReady(baseInput));
    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) expect(exit.value.skipped).toBe("already-exists");
    expect(calls.transcribed).toBe(false);
    expect(calls.deleted).toBe(false);
  });

  it("skips as a clean success when the bot produced no recording", async () => {
    const { layer, calls } = setup({ noteExists: false, audioUrl: undefined });
    const exit = await ManagedRuntime.make(layer).runPromiseExit(handleRecordingReady(baseInput));
    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) expect(exit.value.skipped).toBe("no-recording");
    expect(calls.transcribed).toBe(false);
  });

  it("transcribes, writes the dated note, and purges the recording on the happy path", async () => {
    const { layer, calls } = setup({ noteExists: false, audioUrl: "https://x/a.mp3" });
    const exit = await ManagedRuntime.make(layer).runPromiseExit(handleRecordingReady(baseInput));
    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      expect(exit.value.segments).toBe(1);
      expect(exit.value.notePath).toBe("Meetings/2026-06-18 — Standup.md");
    }
    expect(calls.transcribed).toBe(true);
    expect(calls.created).toBe("Meetings/2026-06-18 — Standup.md");
    expect(calls.deleted).toBe(true);
  });

  it("derives a bot-suffixed path for an untitled meeting (no collision)", async () => {
    const { layer, calls } = setup({ noteExists: false, audioUrl: "https://x/a.mp3" });
    const exit = await ManagedRuntime.make(layer).runPromiseExit(
      handleRecordingReady({ ...baseInput, noteTitle: "" }),
    );
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(calls.created).toBe("Meetings/2026-06-18 — Meeting bot-1234.md");
  });
});
