import { Context, type Effect } from "effect";
import type { CouchDbError } from "../../lib/errors/CouchDbError";
import type { DecryptionError } from "../../lib/errors/DecryptionError";
import type { EncryptionError } from "../../lib/errors/EncryptionError";
import type { NoteConflictError } from "../../lib/errors/NoteConflictError";
import type { NoteNotFoundError } from "../../lib/errors/NoteNotFoundError";
import type { NoteRead, NoteSummary } from "../types.ts";

/**
 * The shape of the vault — read and write operations expressed in terms
 * of vault paths and parsed note bodies, with chunk reassembly,
 * encryption/decryption, and conflict retries handled inside.
 */
export interface VaultImpl {
  readonly listNotes: (
    folderPrefix: string | undefined,
    limit: number,
  ) => Effect.Effect<ReadonlyArray<NoteSummary>, CouchDbError | DecryptionError>;
  readonly listRecent: (
    limit: number,
  ) => Effect.Effect<ReadonlyArray<NoteSummary>, CouchDbError | DecryptionError>;
  readonly readNote: (
    path: string,
  ) => Effect.Effect<
    NoteRead,
    CouchDbError | DecryptionError | NoteNotFoundError | EncryptionError
  >;
  readonly readAllForIndex: () => Effect.Effect<
    ReadonlyArray<NoteRead>,
    CouchDbError | DecryptionError
  >;
  readonly createNote: (
    path: string,
    body: string,
    frontmatter: Record<string, unknown> | undefined,
  ) => Effect.Effect<
    NoteRead,
    CouchDbError | DecryptionError | EncryptionError | NoteConflictError
  >;
  readonly updateNote: (
    path: string,
    body: string | undefined,
    frontmatterPatch: Record<string, unknown> | undefined,
  ) => Effect.Effect<
    NoteRead,
    CouchDbError | DecryptionError | NoteNotFoundError | EncryptionError | NoteConflictError
  >;
  readonly appendToNote: (
    path: string,
    content: string,
  ) => Effect.Effect<
    NoteRead,
    CouchDbError | DecryptionError | NoteNotFoundError | EncryptionError | NoteConflictError
  >;
  readonly deleteNote: (
    path: string,
  ) => Effect.Effect<
    void,
    CouchDbError | DecryptionError | NoteNotFoundError | EncryptionError | NoteConflictError
  >;
}

/**
 * The Vault Effect Context tag. Wired in at boot by `VaultLayer`;
 * MCP tool handlers pull it via Effect.gen.
 */
export class Vault extends Context.Tag("Vault")<Vault, VaultImpl>() {}
