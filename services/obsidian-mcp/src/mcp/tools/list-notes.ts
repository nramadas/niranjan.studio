import { z } from "zod";
import { Effect, type Runtime } from "effect";
import { Vault } from "../../couchdb/vault.js";
import { SearchIndex } from "../../search/index.js";
import { runTool } from "../tool-runtime.js";

type R = Runtime.Runtime<Vault | SearchIndex>;

export const listNotesInputShape = {
  folder_prefix: z
    .string()
    .optional()
    .describe(
      "Optional vault-relative path prefix (e.g. `Daily/`). Only notes whose path starts with this prefix are returned.",
    ),
  limit: z.number().int().positive().max(500).default(100).describe("Maximum number of notes to return."),
} as const;

export const listNotesConfig = {
  title: "List notes",
  description:
    "List notes in the Obsidian vault, optionally filtered by folder prefix. Returns paths and titles only — call read_note for the contents. Use this when you need an overview of the vault or want to discover what notes exist under a specific folder.",
  inputSchema: listNotesInputShape,
};

export const listNotesHandler =
  (runtime: R) =>
  async (args: { folder_prefix?: string; limit?: number }) =>
    runTool(runtime)(
      Effect.gen(function* () {
        const vault = yield* Vault;
        const limit = args.limit ?? 100;
        return yield* vault.listNotes(args.folder_prefix, limit);
      }),
    );
