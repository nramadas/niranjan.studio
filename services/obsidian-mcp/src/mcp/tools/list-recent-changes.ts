import { z } from "zod";
import { Effect, type Runtime } from "effect";
import { Vault } from "../../couchdb/vault.js";
import { SearchIndex } from "../../search/index.js";
import { runTool } from "../tool-runtime.js";

type R = Runtime.Runtime<Vault | SearchIndex>;

export const listRecentChangesInputShape = {
  limit: z.number().int().positive().max(100).default(20).describe("Maximum number of recent notes to return."),
} as const;

export const listRecentChangesConfig = {
  title: "List recent changes",
  description:
    "Return the N most recently modified notes in the vault, ordered most-recent-first. Useful when picking up a conversation about whatever the user was just working on, or when surfacing today's daily notes.",
  inputSchema: listRecentChangesInputShape,
};

export const listRecentChangesHandler =
  (runtime: R) =>
  async (args: { limit?: number }) =>
    runTool(runtime)(
      Effect.gen(function* () {
        const vault = yield* Vault;
        return yield* vault.listRecent(args.limit ?? 20);
      }),
    );
