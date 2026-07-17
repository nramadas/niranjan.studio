import type { Implementation } from "@modelcontextprotocol/sdk/types.js";
import { logoIconDataUri } from "../logoAssets";

/**
 * How this MCP server presents itself in the `initialize` response. The
 * connector is branded "Sutra" — `title` is the human-readable display name
 * (the recommended fallback for clients that don't read `name`), and `icons`
 * carries the logo as a self-contained data-URI so it needs no separate asset
 * route or domain to resolve.
 *
 * Caveat: Claude.ai does not yet render an MCP server's advertised `icons` in
 * its connector list (it shows a generic globe for custom connectors), so the
 * logo surfaces in icon-aware clients today and in Claude once that ships. The
 * same bytes are also served at /favicon.ico + /icon.png from main.ts as a
 * favicon-fallback hedge.
 *
 * `name` stays a lowercase slug (the programmatic identifier); the internal
 * service, package, and infra remain `obsidian-mcp` — only the presented
 * identity is rebranded.
 */
export const serverInfo: Implementation = {
  name: "sutra",
  title: "Sutra",
  version: "0.1.0",
  description: "Read, search, and edit your Obsidian vault — your notes, available to Claude.",
  icons: [{ src: logoIconDataUri, mimeType: "image/png", sizes: ["96x96"] }],
};
