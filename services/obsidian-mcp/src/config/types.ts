// Cross-cutting types used by multiple config exports inside this module.
// Per the styleguide, types reused across more than one function-folder
// belong at the module level, not inside any one folder.

export type AuthProviderKind = "cloudflare-access" | "disabled";
