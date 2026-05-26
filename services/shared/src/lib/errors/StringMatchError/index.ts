import { Data } from "effect";

/**
 * Surfaced by `Vault.editNote` when the find/replace operation can't be
 * performed unambiguously: either the search string isn't in the note,
 * or it appears multiple times and the caller didn't pass
 * `replaceAll: true`. Carries a `reason` discriminator so the MCP tool
 * can render a targeted message back to the agent.
 *
 * @property path        The vault-relative path the caller supplied.
 * @property reason      Which kind of mismatch happened.
 * @property occurrences How many times the search string appeared.
 */
export class StringMatchError extends Data.TaggedError("StringMatchError")<{
  readonly path: string;
  readonly reason: "not_found" | "ambiguous";
  readonly occurrences: number;
}> {}
