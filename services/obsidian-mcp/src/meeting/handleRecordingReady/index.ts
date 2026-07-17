import { Vault } from "@niranjan/vault-shared/couchdb";
import { Effect } from "effect";
import { RecallClient } from "../RecallClient";
import { TranscriptionClient } from "../TranscriptionClient";
import { alignSpeakerNames } from "../alignSpeakerNames";
import { buildMeetingNotePath, formatTranscript } from "../formatTranscript";

export interface RecordingReadyInput {
  readonly botId: string;
  /** Title from the bot metadata; falls back to a bot-derived name if empty. */
  readonly noteTitle: string;
  /** ISO timestamp the bot was dispatched (from metadata); used as the meeting start. */
  readonly startedAt?: string;
  /** Vault folder to file the transcript under. */
  readonly folder: string;
  /** YYYY-MM-DD for the filename + frontmatter (deterministic across retries). */
  readonly date: string;
}

export interface RecordingReadyResult {
  readonly notePath: string;
  readonly segments: number;
  /** Set when the webhook was a no-op (already processed, or no recording). */
  readonly skipped?: string;
}

/**
 * The webhook payoff: a Recall recording is ready, so fetch its audio, run
 * it through the transcription-service, write the transcript into the vault
 * as an E2EE note, then purge Recall's copy.
 *
 * Returns a *successful* skip (rather than failing) in two cases so the
 * webhook responds 200 and Svix stops retrying:
 *   - a transcript note for this meeting already exists — a retry or a
 *     post-media-delete redelivery (durable idempotency on the deterministic
 *     path);
 *   - the bot produced no recording at all (recording denied / kicked /
 *     never admitted / empty call) — bot.done fires for these too and there
 *     is nothing to transcribe; a 500 here would make Svix retry forever and
 *     eventually disable the endpoint.
 *
 * The deterministic path (dispatch-time date + title, with a bot-id suffix
 * for untitled meetings) is what makes the pre-check, the createNote
 * conflict-catch, and cross-retry/cross-instance behaviour idempotent.
 */
export const handleRecordingReady = (input: RecordingReadyInput) =>
  Effect.gen(function* () {
    const recall = yield* RecallClient;
    const transcription = yield* TranscriptionClient;
    const vault = yield* Vault;

    // Untitled meetings get a bot-derived suffix so two untitled meetings on
    // the same day don't collide on a single "Meeting" path (which would
    // silently drop the second transcript).
    const title = input.noteTitle.trim() || `Meeting ${input.botId.slice(0, 8)}`;
    const path = buildMeetingNotePath(input.folder, input.date, title);

    // Durable idempotency: if the note already exists this is a retry /
    // redelivery (including after the media was deleted) — skip and ack 200.
    const exists = yield* vault.readNote(path).pipe(
      Effect.as(true),
      Effect.catchTag("NoteNotFoundError", () => Effect.succeed(false)),
    );
    if (exists) {
      yield* Effect.logInfo(
        `recall webhook: transcript already exists at ${path}; skipping bot ${input.botId}`,
      );
      return {
        notePath: path,
        segments: 0,
        skipped: "already-exists",
      } satisfies RecordingReadyResult;
    }

    yield* Effect.logInfo(`recall webhook: processing recording for bot ${input.botId}`);

    const recording = yield* recall.getRecording(input.botId);
    if (!recording.audioUrl) {
      yield* Effect.logWarning(
        `recall webhook: bot ${input.botId} produced no recording; nothing to transcribe`,
      );
      return { notePath: "", segments: 0, skipped: "no-recording" } satisfies RecordingReadyResult;
    }

    const transcript = yield* transcription.transcribe({ url: recording.audioUrl }, true);

    // Attribute each anonymous diarization index to a real participant by
    // overlapping the transcript's segment times with Recall's speaker timeline.
    const speakerNames = alignSpeakerNames(transcript.segments, recording.speakerTimeline);

    const formatted = formatTranscript(
      transcript.segments,
      {
        title,
        botId: input.botId,
        stt: transcript.modelName,
        platform: recording.platform,
        startedAt: input.startedAt,
        durationSec: transcript.durationSec,
        participants: recording.participants,
        language: transcript.language,
        speakerNames,
      },
      input.folder,
      input.date,
    );

    yield* vault
      .createNote(formatted.path, formatted.body, formatted.frontmatter)
      .pipe(
        Effect.catchTag("NoteConflictError", () =>
          Effect.logWarning(
            `note already exists at ${formatted.path}; treating webhook as already-processed`,
          ),
        ),
      );

    yield* recall
      .deleteMedia(input.botId)
      .pipe(
        Effect.catchAll((e) =>
          Effect.logWarning(`recall deleteMedia failed for ${input.botId}: ${e.message}`),
        ),
      );

    yield* Effect.logInfo(
      `recall webhook: wrote ${formatted.path} (${transcript.segments.length} segments)`,
    );
    return {
      notePath: formatted.path,
      segments: transcript.segments.length,
    } satisfies RecordingReadyResult;
  });
