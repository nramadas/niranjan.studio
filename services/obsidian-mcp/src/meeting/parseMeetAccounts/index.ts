import { Redacted } from "effect";
import type { MeetAccount } from "../types.ts";

/**
 * Parse the MEET_ACCOUNTS_JSON secret into the list of Google accounts whose
 * Meet transcripts are ingested. The expected shape is a JSON array of
 * `{ "name", "refreshToken", "targetResource" }` objects (see
 * scripts/obsidian-mcp/get-google-refresh-token.mjs, which prints entries in
 * exactly this shape). Refresh tokens are wrapped in Redacted immediately so
 * they never travel as bare strings past this boundary.
 *
 * An empty/blank input parses to an empty list — a deployment with Meet
 * ingestion disabled shouldn't need the secret populated at all.
 *
 * @param json The raw secret value.
 * @returns    The validated account list.
 * @throws     Error with a human-readable message on malformed JSON, a
 *             non-array root, a missing/blank field, a duplicate account
 *             name, or a targetResource that isn't a full resource name.
 *             Thrown (not an Effect failure) because the only caller is
 *             boot-time validation, where dying with the message is the
 *             point.
 */
export const parseMeetAccounts = (json: string): ReadonlyArray<MeetAccount> => {
  if (json.trim() === "") return [];

  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    // Deliberately no cause detail: V8's SyntaxError messages quote a
    // snippet of the raw input, which here can contain refresh tokens, and
    // this error string ends up in Cloud Logging via the boot dieMessage.
    throw new Error(
      "MEET_ACCOUNTS_JSON is not valid JSON (detail withheld — the value is a secret; validate it locally with jq)",
    );
  }
  if (!Array.isArray(raw)) {
    throw new Error("MEET_ACCOUNTS_JSON must be a JSON array of account objects");
  }

  const seen = new Set<string>();
  return raw.map((entry, i) => {
    const e = (entry ?? {}) as Record<string, unknown>;
    const name = typeof e.name === "string" ? e.name.trim() : "";
    const refreshToken = typeof e.refreshToken === "string" ? e.refreshToken.trim() : "";
    const targetResource = typeof e.targetResource === "string" ? e.targetResource.trim() : "";

    if (!name) throw new Error(`MEET_ACCOUNTS_JSON accounts[${i}]: missing "name"`);
    if (seen.has(name)) {
      throw new Error(`MEET_ACCOUNTS_JSON accounts[${i}]: duplicate name "${name}"`);
    }
    seen.add(name);
    if (!refreshToken) {
      throw new Error(`MEET_ACCOUNTS_JSON accounts[${i}] ("${name}"): missing "refreshToken"`);
    }
    if (!targetResource.startsWith("//")) {
      throw new Error(
        `MEET_ACCOUNTS_JSON accounts[${i}] ("${name}"): "targetResource" must be a full resource name like //cloudidentity.googleapis.com/users/{id}`,
      );
    }

    return { name, refreshToken: Redacted.make(refreshToken), targetResource };
  });
};
