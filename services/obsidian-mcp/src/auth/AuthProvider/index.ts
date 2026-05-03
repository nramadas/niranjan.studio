import { Context } from "effect";
import type { AuthProviderImpl } from "../types.ts";

/**
 * The AuthProvider Effect Context tag. Tools and middleware that need an
 * authenticated identity declare a dependency on this tag; the runtime
 * resolves it to whichever provider implementation was wired in at boot
 * (OAuthAuthProviderLayer in the current production config — there is no
 * other implementation today).
 *
 * Read docs/obsidian-mcp/auth.md before changing this — the abstraction
 * is deliberate and exists so the auth boundary can be migrated without
 * touching downstream tools.
 */
export class AuthProvider extends Context.Tag("AuthProvider")<AuthProvider, AuthProviderImpl>() {}
