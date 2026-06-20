import { Context, type Effect } from "effect";
import type { RecallError } from "../errors/RecallError";

/** A meeting bot, as the MCP cares about it. */
export interface RecallBotInfo {
  readonly id: string;
  /** Latest status code Recall reported (e.g. "joining_call", "done"), if known. */
  readonly status?: string;
}

/** A finished recording: where to fetch the audio + who was present. */
export interface RecallRecording {
  /** Downloadable audio URL, if the recording is ready and has audio. */
  readonly audioUrl?: string;
  /** Participant display names from the bot's participant timeline. */
  readonly participants: ReadonlyArray<string>;
  /** Meeting platform Recall detected ("zoom", "google_meet", "teams"), if known. */
  readonly platform?: string;
}

export interface CreateBotInput {
  readonly meetingUrl: string;
  /** Arbitrary key/values echoed back in webhooks (we stash the note title here). */
  readonly metadata: Record<string, string>;
}

/**
 * The Recall.ai meeting-bot client. Dispatches and removes bots and reads
 * a finished recording. Failures map to the tagged `RecallError`.
 */
export interface RecallClientImpl {
  readonly createBot: (input: CreateBotInput) => Effect.Effect<RecallBotInfo, RecallError>;
  readonly getBot: (botId: string) => Effect.Effect<RecallBotInfo, RecallError>;
  readonly leaveCall: (botId: string) => Effect.Effect<void, RecallError>;
  readonly getRecording: (botId: string) => Effect.Effect<RecallRecording, RecallError>;
  /** Best-effort: purge Recall's copy of the recording after we have the transcript. */
  readonly deleteMedia: (botId: string) => Effect.Effect<void, RecallError>;
}

/** The RecallClient Effect Context tag. Wired in by `RecallClientLayer`. */
export class RecallClient extends Context.Tag("RecallClient")<RecallClient, RecallClientImpl>() {}
