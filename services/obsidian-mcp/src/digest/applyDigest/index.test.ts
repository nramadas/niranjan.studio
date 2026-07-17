import { Vault, type VaultImpl } from "@niranjan/vault-shared/couchdb";
import { NoteNotFoundError } from "@niranjan/vault-shared/lib/errors";
import { Effect, Exit, Layer, ManagedRuntime } from "effect";
import { describe, expect, it } from "vitest";
import { DigestClient, type DigestClientImpl } from "../DigestClient";
import { DigestError } from "../errors/DigestError";
import { applyDigest } from "./index.ts";

interface Notes {
  [path: string]: string;
}

const setup = (opts: { notes?: Notes; mergeFails?: boolean; mergeReturns?: string }) => {
  const notes: Notes = { ...(opts.notes ?? {}) };
  const writes: Array<{ path: string; kind: "create" | "update" }> = [];

  const vault: VaultImpl = {
    listNotes: () => Effect.succeed([]),
    listRecent: () => Effect.succeed([]),
    readNote: ((path: string) =>
      path in notes
        ? Effect.succeed({ path, body: notes[path] })
        : Effect.fail(new NoteNotFoundError({ path }))) as never,
    readNoteById: () => Effect.fail(new Error("stub")) as never,
    readAllForIndex: () => Effect.succeed([]),
    createNote: ((path: string, body: string) => {
      notes[path] = body;
      writes.push({ path, kind: "create" });
      return Effect.succeed({ path });
    }) as never,
    updateNote: ((path: string, body: string) => {
      notes[path] = body;
      writes.push({ path, kind: "update" });
      return Effect.succeed({ path });
    }) as never,
    appendToNote: () => Effect.succeed({} as never),
    editNote: () => Effect.succeed({} as never),
    deleteNote: () => Effect.void,
  };

  const digestClient: DigestClientImpl = {
    digestTranscript: () => Effect.die("not used in applyDigest"),
    mergeTodoList: (input) =>
      opts.mergeFails
        ? Effect.fail(new DigestError({ op: "merge_todos", message: "boom" }))
        : opts.mergeReturns !== undefined
          ? Effect.succeed(opts.mergeReturns)
          : Effect.succeed(
              [
                "# TODO",
                "",
                ...input.todos.map((t) => `- [ ] ${t.text}`),
                ...(input.existingMarkdown
                  ? [
                      ...input.existingMarkdown.split("\n").filter((l) => l.startsWith("- [")),
                      "",
                      "<!-- merged -->",
                    ]
                  : []),
              ].join("\n"),
            ),
  };

  const layer = Layer.mergeAll(
    Layer.succeed(Vault, vault),
    Layer.succeed(DigestClient, digestClient),
  );
  return { layer, notes, writes };
};

const baseInput = {
  date: "2026-07-02",
  meetingTitle: "Weekly sync",
  todoNotePath: "TODO.md",
  peopleFolder: "People",
  selfName: "Niranjan",
};

describe("applyDigest", () => {
  it("creates the TODO note and dossiers on first digest", async () => {
    const { layer, notes, writes } = setup({});
    const runtime = ManagedRuntime.make(layer);
    const exit = await runtime.runPromiseExit(
      applyDigest({
        ...baseInput,
        digest: {
          todos: [{ text: "Send the deck", urgent: false }],
          people: [{ name: "Alice Chen", facts: ["Cares about timelines"] }],
        },
      }),
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      expect(exit.value).toEqual({ todosMerged: 1, dossiersUpdated: 1 });
    }
    expect(notes["TODO.md"]).toContain("- [ ] Send the deck");
    expect(notes["People/Alice Chen.md"]).toContain("Cares about timelines");
    expect(writes.every((w) => w.kind === "create")).toBe(true);
  });

  it("updates existing notes and skips self + duplicate facts", async () => {
    const { layer, notes, writes } = setup({
      notes: {
        "TODO.md": "# TODO\n\n- [x] Old item",
        "People/Alice Chen.md": [
          "# Alice Chen",
          "",
          "## Concerns & interests",
          "",
          "- Cares about timelines — 2026-06-01, Kickoff",
          "",
        ].join("\n"),
      },
    });
    const runtime = ManagedRuntime.make(layer);
    const exit = await runtime.runPromiseExit(
      applyDigest({
        ...baseInput,
        digest: {
          todos: [{ text: "Send the deck", urgent: true }],
          people: [
            { name: "Alice Chen", facts: ["Cares about timelines"] }, // duplicate → no write
            { name: "Niranjan Ramadas", facts: ["Should never get a dossier"] },
          ],
        },
      }),
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      expect(exit.value).toEqual({ todosMerged: 1, dossiersUpdated: 0 });
    }
    expect(writes).toEqual([{ path: "TODO.md", kind: "update" }]);
    expect(notes["People/Niranjan Ramadas.md"]).toBeUndefined();
  });

  it("does not touch the TODO note when there are no todos", async () => {
    const { layer, writes } = setup({});
    const runtime = ManagedRuntime.make(layer);
    await runtime.runPromise(
      applyDigest({
        ...baseInput,
        digest: { todos: [], people: [{ name: "Bob", facts: ["Likes graphs"] }] },
      }),
    );
    expect(writes).toEqual([{ path: "People/Bob.md", kind: "create" }]);
  });

  it("degrades to counts of zero when the LLM merge fails, without failing", async () => {
    const { layer, notes } = setup({ mergeFails: true });
    const runtime = ManagedRuntime.make(layer);
    const exit = await runtime.runPromiseExit(
      applyDigest({
        ...baseInput,
        digest: {
          todos: [{ text: "Send the deck", urgent: false }],
          people: [{ name: "Alice", facts: ["Fact"] }],
        },
      }),
    );
    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      expect(exit.value).toEqual({ todosMerged: 0, dossiersUpdated: 1 });
    }
    expect(notes["TODO.md"]).toBeUndefined();
  });

  it("falls back to a deterministic append when the LLM merge shrinks the checklist", async () => {
    const existingTodo = ["# TODO", "", "- [x] Done thing", "- [ ] Keep me", "- [ ] Me too"].join(
      "\n",
    );
    const { layer, notes } = setup({
      notes: { "TODO.md": existingTodo },
      // A destructive "merge" that dropped items — must not be trusted.
      mergeReturns: "# TODO\n\n- [ ] Ship it",
    });
    const runtime = ManagedRuntime.make(layer);
    const exit = await runtime.runPromiseExit(
      applyDigest({
        ...baseInput,
        digest: { todos: [{ text: "Ship it", urgent: true }], people: [] },
      }),
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    // Every pre-existing item survived, and the new todo was appended.
    expect(notes["TODO.md"]).toContain("- [x] Done thing");
    expect(notes["TODO.md"]).toContain("- [ ] Keep me");
    expect(notes["TODO.md"]).toContain("- [ ] Me too");
    expect(notes["TODO.md"]).toContain("Ship it");
  });

  it("sanitizes path-illegal characters in person names", async () => {
    const { layer, notes } = setup({});
    const runtime = ManagedRuntime.make(layer);
    await runtime.runPromise(
      applyDigest({
        ...baseInput,
        digest: {
          todos: [],
          people: [{ name: 'Bob "The Builder" / CEO', facts: ["Fact"] }],
        },
      }),
    );
    expect(Object.keys(notes)).toEqual(["People/Bob The Builder CEO.md"]);
  });
});
