export interface MergeDossierInput {
  readonly name: string;
  readonly facts: ReadonlyArray<string>;
  /** YYYY-MM-DD of the meeting the facts came from. */
  readonly date: string;
  readonly meetingTitle: string;
}

const SECTION_HEADING = "## Concerns & interests";

// Normalize a fact (or an existing bullet's fact part) for duplicate
// detection: case, punctuation, and whitespace insensitive.
const normalize = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();

// A dossier bullet is "- fact — date, meeting". Strip the provenance
// suffix so re-learning the same fact in a later meeting still dedupes.
const factPartOfBullet = (line: string): string => {
  const noMarker = line.replace(/^\s*-\s*/, "");
  const emDash = noMarker.lastIndexOf(" — ");
  return emDash >= 0 ? noMarker.slice(0, emDash) : noMarker;
};

/**
 * Fold newly learned facts about a person into their dossier note body,
 * deterministically (no LLM): facts already present anywhere in the note
 * (compared case/punctuation-insensitively, ignoring provenance suffixes)
 * are skipped, new ones are appended as dated bullets under the
 * "Concerns & interests" section, and a missing note/section is created.
 *
 * @param existingBody The dossier note's current body, or undefined when the
 *                     note doesn't exist yet.
 * @param input        The person, their new facts, and provenance.
 * @returns            The complete new note body. Returns `existingBody`
 *                     unchanged (when it exists) if every fact was a
 *                     duplicate, so callers can skip a no-op vault write.
 */
export const mergeDossier = (
  existingBody: string | undefined,
  input: MergeDossierInput,
): string => {
  const fresh = existingBody === undefined || existingBody.trim() === "";
  const lines = fresh ? [`# ${input.name}`, "", SECTION_HEADING, ""] : existingBody.split("\n");

  const seen = new Set<string>();
  for (const line of lines) {
    if (/^\s*-\s+/.test(line)) seen.add(normalize(factPartOfBullet(line)));
  }

  const additions = input.facts
    .map((f) => f.trim())
    .filter((f) => f.length > 0 && !seen.has(normalize(f)))
    .map((f) => `- ${f} — ${input.date}, ${input.meetingTitle}`);

  if (additions.length === 0) {
    return fresh ? `${lines.join("\n").trimEnd()}\n` : (existingBody as string);
  }

  // Insert at the end of the section: right before the next "## " heading
  // after it, or at the end of the note. If the section is missing from an
  // existing note, append it.
  let sectionIdx = lines.findIndex((l) => l.trim().toLowerCase() === SECTION_HEADING.toLowerCase());
  if (sectionIdx === -1) {
    if (lines[lines.length - 1]?.trim() !== "") lines.push("");
    lines.push(SECTION_HEADING, "");
    sectionIdx = lines.length - 2;
  }
  let insertAt = lines.length;
  for (let i = sectionIdx + 1; i < lines.length; i++) {
    if (/^##\s/.test(lines[i] ?? "")) {
      insertAt = i;
      break;
    }
  }
  // Back up over trailing blank lines so bullets join the existing list —
  // but never past the blank line that separates the heading from its body.
  while (insertAt > sectionIdx + 2 && (lines[insertAt - 1] ?? "").trim() === "") insertAt--;

  lines.splice(insertAt, 0, ...additions);
  return `${lines.join("\n").trimEnd()}\n`;
};
