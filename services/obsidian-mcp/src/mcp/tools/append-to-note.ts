import { z } from "zod";
import { Effect, type Runtime } from "effect";
import { Vault } from "../../couchdb/vault.js";
import { SearchIndex } from "../../search/index.js";
import { runTool } from "../tool-runtime.js";

type R = Runtime.Runtime<Vault | SearchIndex>;

export const appendToNoteInputShape = {
  path: z.string().min(1).describe("Vault-relative path of the note to append to."),
  content: z.string().min(1).describe("Block of markdown content to append. A newline is inserted between the existing body and the appended content if the body doesn't already end with one."),
} as const;

export const appendToNoteConfig = {
  title: "Append to note",
  description:
    "Append a block of content to the end of an existing note. Useful for daily-note style workflows or for adding meeting notes / observations without rewriting the whole note. Frontmatter is preserved as-is. Conflict-aware (reads the current revision and retries once on 409).",
  inputSchema: appendToNoteInputShape,
};

export const appendToNoteHandler =
  (runtime: R) =>
  async (args: { path: string; content: string }) =>
    runTool(runtime)(
      Effect.gen(function* () {
        const vault = yield* Vault;
        return yield* vault.appendToNote(args.path, args.content);
      }),
    );
