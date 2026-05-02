// AuthProvider is the seam between the MCP server and whatever external
// identity system gates access to it. The current implementation is
// CloudflareAccessAuthProvider; future migrations to GCP IAP or self-hosted
// OIDC are a layer swap, not a server rewrite.
//
// Read docs/obsidian-mcp/auth.md before changing this — it documents the
// trust model, the migration recipe, and the (deliberate) design intent
// behind keeping this interface narrow.

import { Context, Effect } from "effect";
import { AuthError } from "../lib/errors.js";
import type { Identity } from "./identity.js";

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

export interface AuthProviderImpl {
  readonly name: string;
  readonly validateRequest: (req: AuthRequest) => Effect.Effect<Identity, AuthError>;
}

export class AuthProvider extends Context.Tag("AuthProvider")<AuthProvider, AuthProviderImpl>() {}
