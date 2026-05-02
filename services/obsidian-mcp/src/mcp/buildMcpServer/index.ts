import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { appendToNote } from "../tools/appendToNote";
import { createNote } from "../tools/createNote";
import { deleteNote } from "../tools/deleteNote";
import { listNotes } from "../tools/listNotes";
import { listRecentChanges } from "../tools/listRecentChanges";
import { readNote } from "../tools/readNote";
import { searchNotes } from "../tools/searchNotes";
import { updateNote } from "../tools/updateNote";
import type { ServerRuntime } from "../types.ts";

/**
 * Build an `McpServer` with all eight tools registered. The Effect runtime
 * is captured at construction time and reused per-request so each tool
 * invocation gets a single short-lived Effect program against the
 * already-resolved Vault and SearchIndex.
 *
 * @param runtime The Effect runtime resolved at boot — must satisfy
 *                Vault and SearchIndex tags.
 * @returns       The constructed McpServer, ready to attach to a transport.
 */
export const buildMcpServer = (runtime: ServerRuntime): McpServer => {
  const server = new McpServer(
    { name: "obsidian-mcp", version: "0.1.0" },
    {
      capabilities: { tools: {} },
      instructions:
        "Read, search, and edit the user's Obsidian vault. Notes are stored as markdown with optional YAML frontmatter. Prefer search_notes over list_notes when looking for content; prefer update_note over delete_note + create_note for in-place edits.",
    },
  );

  // Register tools individually rather than via a loop because the SDK
  // generic infers the input-schema type per call; iterating collapses
  // all eight factories into a union and the inferred schema goes wrong.
  const reg = (t: { name: string; config: never; handler: never }) =>
    server.registerTool(t.name, t.config, t.handler);
  reg(listNotes(runtime) as never);
  reg(readNote(runtime) as never);
  reg(searchNotes(runtime) as never);
  reg(createNote(runtime) as never);
  reg(updateNote(runtime) as never);
  reg(appendToNote(runtime) as never);
  reg(deleteNote(runtime) as never);
  reg(listRecentChanges(runtime) as never);

  return server;
};
