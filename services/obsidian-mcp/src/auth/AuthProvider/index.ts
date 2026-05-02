import { Context } from "effect";
import type { AuthProviderImpl } from "../types.ts";

/**
 * The AuthProvider Effect Context tag. Tools and middleware that need an
 * authenticated identity declare a dependency on this tag; the runtime
 * resolves it to whichever provider implementation was wired in at boot
 * (CloudflareAccessAuthProviderLayer in production,
 * DisabledAuthProviderLayer in local dev).
 *
 * Read docs/obsidian-mcp/auth.md before changing this — the abstraction
 * is deliberate and exists so the auth provider can be migrated without a
 * server rewrite.
 */
export class AuthProvider extends Context.Tag("AuthProvider")<AuthProvider, AuthProviderImpl>() {}
