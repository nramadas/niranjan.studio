// Constants drawn from LiveSync's document model. Used across multiple
// function-folders inside this module (path2id, decryptField, encryptField,
// the chunk readers in vault), so they live at the module level per the
// styleguide.

/** Prefix LiveSync applies to a `_id` (and the `path` field) when path obfuscation is on. */
export const PREFIX_OBFUSCATED = "f:" as const;

/** Prefix that marks a CouchDB document as a plaintext chunk leaf. */
export const PREFIX_CHUNK = "h:" as const;

/**
 * Prefix LiveSync uses for ENCRYPTED chunk leaves. The `+` after `h:`
 * is what the plugin's `isEncryptedChunkEntry` test keys on — chunks
 * with plain `h:` IDs are treated as plaintext even if they carry
 * `e_: true`, which means our HKDF ciphertext would be inserted into
 * notes as literal text. Always use this prefix for chunks we encrypt.
 */
export const PREFIX_ENCRYPTED_CHUNK = "h:+" as const;

// Encryption prefixes used by the LiveSync plugin. Order matters for the
// startsWith dispatch — `%~`, `%=`, and `%$` must be checked before the
// bare `%` legacy prefix.
const HKDF_SALTED_ENCRYPTED_PREFIX = "%$" as const;
const HKDF_FIXED_ENCRYPTED_PREFIX = "%=" as const;
const LEGACY_V3_PREFIX = "%~" as const;
const LEGACY_V2_PREFIX_PROBABLY = "%" as const;

export const PREFIX_HKDF_EPHEMERAL = HKDF_SALTED_ENCRYPTED_PREFIX;
export const PREFIX_HKDF_FIXED = HKDF_FIXED_ENCRYPTED_PREFIX;
export const PREFIX_LEGACY_V3 = LEGACY_V3_PREFIX;
export const PREFIX_LEGACY_V2_PROBABLY = LEGACY_V2_PREFIX_PROBABLY;

export const ENCRYPTED_PREFIXES = [
  PREFIX_HKDF_EPHEMERAL,
  PREFIX_HKDF_FIXED,
  PREFIX_LEGACY_V3,
  PREFIX_LEGACY_V2_PROBABLY,
] as const;

/**
 * Marker prepended to the `path` field when path obfuscation is on. The
 * suffix is an HKDF ciphertext of a JSON-encoded EncryptProps blob. Must
 * match livesync-commonlib's `ENCRYPTED_META_PREFIX` byte-for-byte.
 */
export const ENCRYPTED_META_PREFIX = "/\\:" as const;

/**
 * Eden key under which HKDF-encrypted inline content lives. Eden is
 * LiveSync's small-file fast-path: rather than splitting tiny notes into
 * chunks, the body is stored inline on the note doc under this key.
 */
export const EDEN_ENCRYPTED_KEY_HKDF = "h:++encrypted-hkdf" as const;

/**
 * Document id of the LiveSync sync-parameters local doc. Holds the
 * PBKDF2 salt the plugin uses for HKDF — the server has to read this at
 * boot and use the exact same bytes for encryption to round-trip.
 */
export const SYNC_PARAMETERS_DOC_ID = "_local/obsidian_livesync_sync_parameters" as const;
