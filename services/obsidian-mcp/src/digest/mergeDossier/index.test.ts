import { describe, expect, it } from "vitest";
import { mergeDossier } from "./index.ts";

const input = {
  name: "Alice Chen",
  facts: ["Cares deeply about launch timelines", "Worried about API latency"],
  date: "2026-07-02",
  meetingTitle: "Weekly sync",
};

describe("mergeDossier", () => {
  it("creates a fresh dossier when the note does not exist", () => {
    const out = mergeDossier(undefined, input);
    expect(out).toBe(
      [
        "# Alice Chen",
        "",
        "## Concerns & interests",
        "",
        "- Cares deeply about launch timelines — 2026-07-02, Weekly sync",
        "- Worried about API latency — 2026-07-02, Weekly sync",
        "",
      ].join("\n"),
    );
  });

  it("appends only new facts to an existing section", () => {
    const existing = [
      "# Alice Chen",
      "",
      "## Concerns & interests",
      "",
      "- Worried about API latency — 2026-06-01, Kickoff",
      "",
    ].join("\n");

    const out = mergeDossier(existing, input);
    expect(out).toContain("- Worried about API latency — 2026-06-01, Kickoff");
    expect(out).toContain("- Cares deeply about launch timelines — 2026-07-02, Weekly sync");
    // The duplicate wasn't re-added under the new date.
    expect(out.match(/API latency/g)).toHaveLength(1);
  });

  it("dedupes case- and punctuation-insensitively", () => {
    const existing = [
      "# Alice Chen",
      "",
      "## Concerns & interests",
      "",
      "- cares deeply about launch timelines! — 2026-06-01, Kickoff",
      "",
    ].join("\n");

    const out = mergeDossier(existing, {
      ...input,
      facts: ["Cares deeply about launch timelines"],
    });
    expect(out).toBe(existing);
  });

  it("keeps new bullets inside the section when later sections exist", () => {
    const existing = [
      "# Alice Chen",
      "",
      "## Concerns & interests",
      "",
      "- Existing fact — 2026-06-01, Kickoff",
      "",
      "## Meetings",
      "",
      "- 2026-06-01 Kickoff",
      "",
    ].join("\n");

    const out = mergeDossier(existing, { ...input, facts: ["Brand new fact"] });
    const sectionEnd = out.indexOf("## Meetings");
    expect(out.indexOf("Brand new fact")).toBeGreaterThan(-1);
    expect(out.indexOf("Brand new fact")).toBeLessThan(sectionEnd);
  });

  it("adds the section to an existing note that lacks it", () => {
    const existing = ["# Alice Chen", "", "Some free-form intro.", ""].join("\n");
    const out = mergeDossier(existing, { ...input, facts: ["New fact"] });
    expect(out).toContain("## Concerns & interests");
    expect(out).toContain("- New fact — 2026-07-02, Weekly sync");
  });

  it("returns the body unchanged when every fact is a duplicate", () => {
    const existing = [
      "# Alice Chen",
      "",
      "## Concerns & interests",
      "",
      "- Only fact — 2026-06-01, Kickoff",
      "",
    ].join("\n");
    const out = mergeDossier(existing, { ...input, facts: ["Only fact"] });
    expect(out).toBe(existing);
  });
});
