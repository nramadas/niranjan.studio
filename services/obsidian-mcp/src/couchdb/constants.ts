// Constants drawn from LiveSync's document model. Used across multiple
// function-folders inside this module (path2id, decryptField, encryptField,
// the chunk readers in vault), so they live at the module level per the
// styleguide.

/** Prefix LiveSync applies to a `_id` (and the `path` field) when path obfuscation is on. */
export const PREFIX_OBFUSCATED = "f:" as const;

/** Prefix that marks a CouchDB document as a chunk leaf (`type: "leaf"`). */
export const PREFIX_CHUNK = "h:" as const;

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
