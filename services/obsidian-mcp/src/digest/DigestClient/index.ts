import { Context, type Effect } from "effect";
import type { DigestError } from "../errors/DigestError";
import type { DigestTodo, TranscriptDigest } from "../types.ts";

export interface DigestTranscriptInput {
  /** The formatted transcript note body (speaker-labelled markdown). */
  readonly transcriptMarkdown: string;
  /** Display names of everyone on the call. */
  readonly participants: ReadonlyArray<string>;
  /** Whose todos to extract (e.g. "Niranjan"). */
  readonly selfName: string;
}

export interface MergeTodoListInput {
  /** Current body of the TODO note; empty string when the note is new. */
  readonly existingMarkdown: string;
  /** Newly extracted todos to fold in. */
  readonly todos: ReadonlyArray<DigestTodo>;
  /** YYYY-MM-DD of the meeting, used to annotate new items. */
  readonly date: string;
  readonly meetingTitle: string;
  readonly selfName: string;
}

export interface DigestClientImpl {
  /** Pull {selfName}'s action items + per-person facts out of a transcript. */
  readonly digestTranscript: (
    input: DigestTranscriptInput,
  ) => Effect.Effect<TranscriptDigest, DigestError>;
  /**
   * Fold new todos into the existing TODO note, returning the complete new
   * note body: one deduplicated checklist, urgent items first, existing
   * items (including completed ones) preserved.
   */
  readonly mergeTodoList: (input: MergeTodoListInput) => Effect.Effect<string, DigestError>;
}

/**
 * The transcript-digest Effect Context tag. Wired in at boot by
 * `DigestClientLayer`; `applyDigest` and the /meet/webhook handler pull it
 * via Effect.gen.
 */
export class DigestClient extends Context.Tag("DigestClient")<DigestClient, DigestClientImpl>() {}
