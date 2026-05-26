import { Effect } from "effect";
import { CouchDbError } from "../../lib/errors/CouchDbError";
import type { CouchClientImpl } from "../CouchClient";
import { SYNC_PARAMETERS_DOC_ID } from "../constants.ts";

/**
 * Resolved LiveSync sync parameters. The `pbkdf2Salt` is the master salt
 * the plugin uses for HKDF; both decrypting plugin-written ciphertext and
 * producing ciphertext the plugin will accept require this exact byte
 * sequence. The `protocolVersion` is informational — LiveSync currently
 * emits `2`.
 */
export interface SyncParameters {
  readonly pbkdf2Salt: Uint8Array<ArrayBuffer>;
  readonly protocolVersion: number;
}

interface SyncParametersDoc {
  readonly _id: string;
  readonly type?: string;
  readonly protocolVersion?: number;
  readonly pbkdf2salt?: string;
}

/**
 * Fetch and parse the LiveSync sync-parameters local doc. Called once at
 * boot from `VaultLayer`. Fails if the doc is missing or malformed —
 * better to refuse to start than to silently encrypt with a wrong salt.
 *
 * The doc is at `_local/obsidian_livesync_sync_parameters` (a CouchDB
 * `_local/` doc — not replicated, so each replica would have its own; in
 * practice the plugin writes one and the server reads it). The
 * `pbkdf2salt` field is base64.
 */
export const readSyncParameters = (
  client: CouchClientImpl,
): Effect.Effect<SyncParameters, CouchDbError> =>
  Effect.gen(function* () {
    const doc = yield* client.getDoc<SyncParametersDoc>(SYNC_PARAMETERS_DOC_ID);
    if (!doc) {
      return yield* Effect.fail(
        new CouchDbError({
          op: "readSyncParameters",
          message: `${SYNC_PARAMETERS_DOC_ID} not found — has the LiveSync plugin synced to this database yet?`,
        }),
      );
    }
    if (typeof doc.pbkdf2salt !== "string" || doc.pbkdf2salt.length === 0) {
      return yield* Effect.fail(
        new CouchDbError({
          op: "readSyncParameters",
          message: `${SYNC_PARAMETERS_DOC_ID} is missing a pbkdf2salt — vault may have been written by an older LiveSync version`,
        }),
      );
    }
    const decoded = Buffer.from(doc.pbkdf2salt, "base64");
    // Wrap in a fresh ArrayBuffer-backed Uint8Array. Buffer is a Uint8Array
    // subclass but its underlying buffer is a SharedArrayBuffer-or-similar
    // pool slice; octagonal-wheels' WebCrypto calls demand a real
    // ArrayBuffer-backed view.
    const ab = new ArrayBuffer(decoded.length);
    const salt = new Uint8Array(ab);
    salt.set(decoded);
    return {
      pbkdf2Salt: salt,
      protocolVersion: typeof doc.protocolVersion === "number" ? doc.protocolVersion : 2,
    };
  });
