// What an authenticated request looks like once an AuthProvider has
// validated it. Downstream handlers see only this — they don't know which
// provider verified the identity, which is the entire point of the
// AuthProvider abstraction (see ./provider.ts and docs/obsidian-mcp/auth.md).

export interface Identity {
  /** The authenticated principal's email, or `service-token:<id>` for non-human callers. */
  readonly email: string;
  /** Which AuthProvider validated this identity. Useful for logs and audit trails. */
  readonly source: string;
  /** Provider-specific extra claims, opaque to downstream code. */
  readonly extra?: Readonly<Record<string, unknown>>;
}
