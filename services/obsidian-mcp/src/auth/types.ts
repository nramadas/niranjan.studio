// Cross-cutting types used by multiple exports inside the auth module.
// Per the styleguide, types reused across more than one function-folder
// belong at the module level.

import type { AuthError } from "@niranjan/vault-shared/lib/errors";
import type { Effect } from "effect";

/**
 * What an authenticated request looks like once an AuthProvider has
 * validated it. Downstream handlers see only this — they don't know which
 * provider verified the identity, which is the point of the AuthProvider
 * abstraction (see docs/obsidian-mcp/auth.md).
 */
export interface Identity {
  /** The authenticated principal's email, or `service-token:<id>` for non-human callers. */
  readonly email: string;
  /** Which AuthProvider validated this identity. Useful for logs and audit trails. */
  readonly source: string;
  /** Provider-specific extra claims, opaque to downstream code. */
  readonly extra?: Readonly<Record<string, unknown>>;
}

/**
 * Subset of an HTTP request the AuthProvider needs to validate identity.
 * Defined here (rather than taking a Node IncomingMessage) so a non-Node
 * provider implementation isn't forced to depend on Node types.
 */
export interface AuthRequest {
  /** Header lookup. Names are lowercased. */
  readonly header: (name: string) => string | undefined;
  /** Path component, e.g. `/mcp`. */
  readonly path: string;
  /** Method, e.g. `POST`. */
  readonly method: string;
}

/**
 * The implementation contract for an AuthProvider — the seam between the
 * MCP server and whichever external identity system gates access. See
 * docs/obsidian-mcp/auth.md for the design intent and migration recipe.
 */
export interface AuthProviderImpl {
  readonly name: string;
  readonly validateRequest: (req: AuthRequest) => Effect.Effect<Identity, AuthError>;
}
