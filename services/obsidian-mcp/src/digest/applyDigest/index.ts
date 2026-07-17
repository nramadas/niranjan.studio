import { Vault } from "@niranjan/vault-shared/couchdb";
import { Effect } from "effect";
import { DigestClient } from "../DigestClient";
import { mergeDossier } from "../mergeDossier";
import type { TranscriptDigest } from "../types.ts";

export interface ApplyDigestInput {
  readonly digest: TranscriptDigest;
  /** YYYY-MM-DD of the meeting, used for annotations + `updated` frontmatter. */
  readonly date: string;
  readonly meetingTitle: string;
  /** Vault path of the single TODO note (e.g. "TODO.md"). */
  readonly todoNotePath: string;
  /** Vault folder dossiers live under (e.g. "People"). */
  readonly peopleFolder: string;
  readonly selfName: string;
}

export interface ApplyDigestResult {
  /** Todos folded into the TODO note (0 when there were none or it failed). */
  readonly todosMerged: number;
  /** Dossier notes created or updated. */
  readonly dossiersUpdated: number;
}

// Strip path-illegal characters from a person's display name so it can be
// a vault filename.
const sanitizePersonName = (name: string): string => {
  const cleaned = name
    .replace(/[\\/:*?"<>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.length > 0 ? cleaned : "Unknown";
};

// "Niranjan" should match "Niranjan Ramadas": every token of selfName must
// appear among the person's name tokens.
const isSelf = (personName: string, selfName: string): boolean => {
  const personTokens = personName.toLowerCase().split(/\s+/);
  const selfTokens = selfName.toLowerCase().split(/\s+/).filter(Boolean);
  return selfTokens.length > 0 && selfTokens.every((t) => personTokens.includes(t));
};

const checklistCount = (body: string): number =>
  body.split("\n").filter((l) => /^\s*-\s*\[[ xX]\]/.test(l)).length;

// Safety net for the LLM merge: the model receives the whole existing note
// (built partly from untrusted transcript text) and returns a full
// replacement, so a bad merge — model error or a prompt injection like
// "clear this list" — could silently destroy hand-edited items. Merging can
// only ever combine duplicates with the incoming todos, so the item count
// must never shrink; if it does, fall back to a deterministic append that
// provably preserves the existing body.
const appendTodosFallback = (
  existing: string,
  todos: ReadonlyArray<{ readonly text: string; readonly urgent: boolean }>,
  date: string,
  meetingTitle: string,
): string => {
  const items = [...todos]
    .sort((a, b) => Number(b.urgent) - Number(a.urgent))
    .map((t) => `- [ ] ${t.urgent ? "**urgent:** " : ""}${t.text} *(${meetingTitle}, ${date})*`);
  const base = existing.trim() === "" ? "# TODO" : existing.trimEnd();
  return `${base}\n${items.join("\n")}\n`;
};

/**
 * Write a transcript digest into the vault: fold the todos into the single
 * TODO note (LLM merge — dedupe + urgency ordering) and fold each person's
 * facts into their dossier note (deterministic merge). Everything is
 * best-effort: any individual failure is logged and skipped, the Effect
 * itself never fails, and the result reports what actually landed —
 * digestion is enrichment on top of an already-written transcript, and a
 * failure here must not make the webhook retry the whole ingestion.
 *
 * @param input The digest plus note-placement config.
 * @returns     An Effect (requiring Vault + DigestClient) yielding counts of
 *              merged todos and updated dossiers.
 */
export const applyDigest = (input: ApplyDigestInput) =>
  Effect.gen(function* () {
    const vault = yield* Vault;
    const digestClient = yield* DigestClient;

    let todosMerged = 0;
    if (input.digest.todos.length > 0) {
      todosMerged = yield* Effect.gen(function* () {
        const existing = yield* vault.readNote(input.todoNotePath).pipe(
          Effect.map((n) => n.body),
          Effect.catchTag("NoteNotFoundError", () => Effect.succeed(undefined)),
        );
        const llmMerged = yield* digestClient.mergeTodoList({
          existingMarkdown: existing ?? "",
          todos: input.digest.todos,
          date: input.date,
          meetingTitle: input.meetingTitle,
          selfName: input.selfName,
        });
        let merged = llmMerged;
        if (existing !== undefined && checklistCount(llmMerged) < checklistCount(existing)) {
          yield* Effect.logWarning(
            `digest: LLM todo merge shrank the checklist (${checklistCount(existing)} -> ${checklistCount(llmMerged)} items); using deterministic append instead`,
          );
          merged = appendTodosFallback(
            existing,
            input.digest.todos,
            input.date,
            input.meetingTitle,
          );
        }
        yield* existing === undefined
          ? vault.createNote(input.todoNotePath, merged, { type: "todos", updated: input.date })
          : vault.updateNote(input.todoNotePath, merged, { updated: input.date });
        return input.digest.todos.length;
      }).pipe(
        Effect.catchAll((e) =>
          Effect.logWarning(
            `digest: merging todos into ${input.todoNotePath} failed: ${String(e)}`,
          ).pipe(Effect.as(0)),
        ),
      );
    }

    let dossiersUpdated = 0;
    for (const person of input.digest.people) {
      if (person.facts.length === 0 || isSelf(person.name, input.selfName)) continue;
      const path = `${input.peopleFolder.replace(/\/+$/, "")}/${sanitizePersonName(person.name)}.md`;
      const updated = yield* Effect.gen(function* () {
        const existing = yield* vault.readNote(path).pipe(
          Effect.map((n) => n.body),
          Effect.catchTag("NoteNotFoundError", () => Effect.succeed(undefined)),
        );
        const merged = mergeDossier(existing, {
          name: person.name,
          facts: person.facts,
          date: input.date,
          meetingTitle: input.meetingTitle,
        });
        if (existing !== undefined && merged === existing) return false;
        yield* existing === undefined
          ? vault.createNote(path, merged, {
              type: "person-dossier",
              name: person.name,
              updated: input.date,
            })
          : vault.updateNote(path, merged, { updated: input.date });
        return true;
      }).pipe(
        Effect.catchAll((e) =>
          Effect.logWarning(`digest: updating dossier ${path} failed: ${String(e)}`).pipe(
            Effect.as(false),
          ),
        ),
      );
      if (updated) dossiersUpdated++;
    }

    return { todosMerged, dossiersUpdated } satisfies ApplyDigestResult;
  });
