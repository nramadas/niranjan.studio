import { Vault } from "@niranjan/vault-shared/couchdb";
import { Effect } from "effect";
import { DigestClient, applyDigest } from "../../digest";
import { type ConferenceRecordInfo, type MeetAccountRef, MeetClient } from "../MeetClient";
import { buildMeetSegments } from "../buildMeetSegments";
import type { MeetApiError } from "../errors/MeetApiError";
import { buildMeetingNotePath, formatSegmentLines, formatTranscript } from "../formatTranscript";

export interface MeetTranscriptInput {
  /** Resource name from the webhook: `conferenceRecords/{cr}/transcripts/{t}`. */
  readonly transcriptName: string;
  /**
   * Target resource of the subscription that produced the event, when the
   * delivery carried one — used to try the matching account first.
   */
  readonly targetHint?: string;
  /** Vault folder to file the transcript under. */
  readonly folder: string;
  /** Present when digestion (todos + dossiers) is enabled. */
  readonly digest?: {
    readonly todoNotePath: string;
    readonly peopleFolder: string;
    readonly selfName: string;
  };
}

export interface MeetTranscriptResult {
  readonly notePath: string;
  readonly segments: number;
  /** Which configured account's credentials could read this meeting. */
  readonly account?: string;
  /** Set when the webhook was a no-op (already processed, or nothing usable). */
  readonly skipped?: string;
  /** Set when this transcript was appended to an existing conference note. */
  readonly continued?: boolean;
  readonly todosMerged?: number;
  readonly dossiersUpdated?: number;
}

// Probing classification: which failures mean "this account can't help,
// try the next one" vs "something is broken, fail so Pub/Sub retries".
// 403/404 on the conference read = not a meeting member. 401 = the minted
// bearer was rejected. A refresh_token op failing 400/401 = the account's
// refresh token is revoked/invalid (Google returns 400 invalid_grant) —
// one dead account must not block ingestion for the others.
const isAccountSkippable = (e: MeetApiError): boolean =>
  e.status === 401 ||
  e.status === 403 ||
  e.status === 404 ||
  (e.op.startsWith("refresh_token") && (e.status === 400 || e.status === 401));

/**
 * The Meet-webhook payoff: Google generated a transcript for a meeting, so
 * pull its entries + participants through the Meet REST API, write the
 * formatted transcript into the vault as an E2EE note, then digest it —
 * fold Niranjan's action items into the single TODO note and each
 * participant's facts into their dossier.
 *
 * Multi-account: Meet artifact ACLs follow meeting membership, so the
 * handler first resolves which configured account can read this conference —
 * the account matching the delivery's target hint is tried first, then the
 * rest in configured order (403/404 = not a member; a revoked refresh token
 * skips that account with an error log; transient errors fail the webhook
 * so Pub/Sub retries; no account = ack + skip, retrying can't fix
 * membership).
 *
 * Idempotency is transcript-aware and built ONLY from stable inputs. The
 * note path derives from the conference-record id + start time (the human
 * meeting code is display-only frontmatter — reading it can fail or differ
 * per account, and the path must never depend on anything fallible). The
 * note's `transcripts` frontmatter lists every transcript resource folded
 * in: a redelivery of a known transcript skips; a NEW transcript of the
 * same conference (transcription stopped and restarted mid-meeting) appends
 * a continuation section instead of being dropped. A create/update conflict
 * (two instances racing on the same conference) FAILS the webhook — the
 * retry re-reads the winner's note and lands in the skip/append path, and
 * the digest never runs twice because it only runs after a successful
 * write, on exactly the newly written content.
 */
export const handleMeetTranscript = (input: MeetTranscriptInput) =>
  Effect.gen(function* () {
    const meet = yield* MeetClient;
    const vault = yield* Vault;
    const digestClient = yield* DigestClient;

    const [conferenceRecordName] = input.transcriptName.split("/transcripts/");
    if (!conferenceRecordName || conferenceRecordName === input.transcriptName) {
      yield* Effect.logWarning(
        `meet webhook: malformed transcript name "${input.transcriptName}"; ignoring`,
      );
      const bad: MeetTranscriptResult = {
        notePath: "",
        segments: 0,
        skipped: "bad-transcript-name",
      };
      return bad;
    }

    // Resolve which account can read this conference: hinted account first,
    // then the rest in configured order.
    const hinted = input.targetHint
      ? meet.accounts.find((a) => a.targetResource === input.targetHint)
      : undefined;
    const candidates: ReadonlyArray<MeetAccountRef> = hinted
      ? [hinted, ...meet.accounts.filter((a) => a.name !== hinted.name)]
      : meet.accounts;

    let resolved: { readonly account: string; readonly record: ConferenceRecordInfo } | undefined;
    for (const candidate of candidates) {
      const record = yield* meet.getConferenceRecord(candidate.name, conferenceRecordName).pipe(
        Effect.catchTag("MeetApiError", (e) => {
          if (!isAccountSkippable(e)) return Effect.fail(e);
          const log =
            e.status === 403 || e.status === 404
              ? Effect.logDebug(
                  `meet webhook: account "${candidate.name}" cannot read ${conferenceRecordName} (${e.status})`,
                )
              : Effect.logError(
                  `meet webhook: account "${candidate.name}" has a credential problem, skipping it: ${e.message}`,
                );
          return log.pipe(Effect.as(undefined));
        }),
      );
      if (record) {
        resolved = { account: candidate.name, record };
        break;
      }
    }
    if (!resolved) {
      yield* Effect.logWarning(
        `meet webhook: no configured account (${meet.accounts.map((a) => a.name).join(", ") || "none"}) can read ${conferenceRecordName}; skipping`,
      );
      const noAccess: MeetTranscriptResult = {
        notePath: "",
        segments: 0,
        skipped: "no-account-access",
      };
      return noAccess;
    }
    const { account, record } = resolved;

    // Deterministic title from STABLE inputs only: conference-record id +
    // start time (two occurrences of a recurring meeting on the same day
    // differ by start time). The human meeting code is fetched best-effort
    // for the frontmatter below but must never influence the path — the
    // lookup can fail transiently or differ per account, and a divergent
    // path would defeat the cross-delivery dedupe.
    const crId = conferenceRecordName.slice("conferenceRecords/".length);
    const startIso = record.startTime ?? "";
    const date = startIso.slice(0, 10) || new Date().toISOString().slice(0, 10);
    const hhmm = startIso.slice(11, 16).replace(":", "");
    const title = `Google Meet ${crId.slice(0, 8)}${hhmm ? ` ${hhmm}` : ""}`;
    const path = buildMeetingNotePath(input.folder, date, title);

    // Transcript-aware idempotency: Pub/Sub redelivers until acked, both
    // accounts' subscriptions fire for a shared meeting, and a restarted
    // transcription creates a second transcript resource for the same
    // conference. An existing note whose `transcripts` frontmatter already
    // lists this transcript is a duplicate; one that doesn't gets this
    // transcript appended as a continuation.
    const existing = yield* vault.readNote(path).pipe(
      Effect.map((n) => ({ body: n.body, frontmatter: n.frontmatter })),
      Effect.catchTag("NoteNotFoundError", () => Effect.succeed(undefined)),
    );
    const priorTranscripts = Array.isArray(existing?.frontmatter.transcripts)
      ? existing.frontmatter.transcripts.filter((t): t is string => typeof t === "string")
      : [];
    if (existing && priorTranscripts.includes(input.transcriptName)) {
      yield* Effect.logInfo(
        `meet webhook: ${input.transcriptName} already ingested at ${path}; skipping`,
      );
      const skippedExisting: MeetTranscriptResult = {
        notePath: path,
        segments: 0,
        account,
        skipped: "already-exists",
      };
      return skippedExisting;
    }
    // Defensive: a note at this path without transcript provenance (hand
    // written, or pre-refactor) can't be safely appended to — treat as done.
    if (existing && priorTranscripts.length === 0) {
      yield* Effect.logWarning(
        `meet webhook: note at ${path} has no transcripts frontmatter; treating ${input.transcriptName} as already ingested`,
      );
      const skippedUnknown: MeetTranscriptResult = {
        notePath: path,
        segments: 0,
        account,
        skipped: "already-exists",
      };
      return skippedUnknown;
    }

    yield* Effect.logInfo(`meet webhook: ingesting ${input.transcriptName} as "${account}"`);

    const entries = yield* meet.listTranscriptEntries(account, input.transcriptName);
    // Participant names + meeting code are enrichment: failures degrade to
    // numeric speaker labels / absent frontmatter, never a failed ingestion.
    const participants = yield* meet
      .listParticipants(account, conferenceRecordName)
      .pipe(
        Effect.catchAll((e) =>
          Effect.logWarning(`meet webhook: participants fetch failed: ${e.message}`).pipe(
            Effect.as([]),
          ),
        ),
      );
    const meetingCode = record.space
      ? yield* meet
          .getSpaceMeetingCode(account, record.space)
          .pipe(Effect.catchAll(() => Effect.succeed(undefined)))
      : undefined;

    const { segments, speakerNames } = buildMeetSegments(entries, participants, record.startTime);
    const participantNames = participants.map((p) => p.displayName);

    let noteBodyForDigest: string;
    if (existing) {
      // Continuation: transcription was stopped and restarted, producing a
      // new transcript resource for a conference we already ingested. A
      // conflict on the update means another writer got in between our read
      // and this write — deliberately NOT caught: the webhook fails, Pub/Sub
      // redelivers, and the retry re-reads fresh state.
      const continuation = `\n\n## Transcript (continued)\n\n${formatSegmentLines(segments, speakerNames)}`;
      noteBodyForDigest = continuation;
      yield* vault.updateNote(path, `${existing.body.trimEnd()}${continuation}\n`, {
        transcripts: [...priorTranscripts, input.transcriptName],
      });
      yield* Effect.logInfo(
        `meet webhook: appended continued transcript to ${path} (${segments.length} segments)`,
      );
    } else {
      const durationSec =
        record.startTime && record.endTime
          ? Math.max(0, (Date.parse(record.endTime) - Date.parse(record.startTime)) / 1000)
          : undefined;

      const formatted = formatTranscript(
        segments,
        {
          title,
          source: "google-meet",
          conferenceRecord: conferenceRecordName,
          transcripts: [input.transcriptName],
          meetingCode,
          account,
          stt: "google-meet",
          platform: "google-meet",
          startedAt: record.startTime,
          durationSec,
          participants: participantNames,
          language: entries.find((e) => e.languageCode)?.languageCode,
          speakerNames,
        },
        input.folder,
        date,
      );
      noteBodyForDigest = formatted.body;
      // A conflict means a concurrent delivery (other instance / the other
      // account's event) created the note first — deliberately NOT caught:
      // fail so Pub/Sub retries and the retry lands in the skip/append path
      // above. The digest below therefore never runs for the losing racer.
      yield* vault.createNote(formatted.path, formatted.body, formatted.frontmatter);
      yield* Effect.logInfo(`meet webhook: wrote ${formatted.path} (${segments.length} segments)`);
    }

    // Best-effort digestion — only after a successful write, only on the
    // newly written content, and never failing the webhook (see docstring).
    let todosMerged: number | undefined;
    let dossiersUpdated: number | undefined;
    if (input.digest && segments.length > 0) {
      const digestCfg = input.digest;
      const applied = yield* digestClient
        .digestTranscript({
          transcriptMarkdown: noteBodyForDigest,
          participants: participantNames,
          selfName: digestCfg.selfName,
        })
        .pipe(
          Effect.flatMap((digest) =>
            applyDigest({
              digest,
              date,
              meetingTitle: title,
              todoNotePath: digestCfg.todoNotePath,
              peopleFolder: digestCfg.peopleFolder,
              selfName: digestCfg.selfName,
            }),
          ),
          Effect.catchAll((e) =>
            Effect.logWarning(`meet webhook: digest failed for ${path}: ${String(e)}`).pipe(
              Effect.as(undefined),
            ),
          ),
        );
      todosMerged = applied?.todosMerged;
      dossiersUpdated = applied?.dossiersUpdated;
    }

    const result: MeetTranscriptResult = {
      notePath: path,
      segments: segments.length,
      account,
      ...(existing ? { continued: true } : {}),
      ...(todosMerged !== undefined ? { todosMerged } : {}),
      ...(dossiersUpdated !== undefined ? { dossiersUpdated } : {}),
    };
    return result;
  });
