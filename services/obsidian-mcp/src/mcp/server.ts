// Build an McpServer with all eight tools registered. The Effect runtime
// is captured at construction time and reused per-request so each tool
// invocation gets a single short-lived Effect program (config / vault /
// search resolved at boot).

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Runtime } from "effect";
import { Vault } from "../couchdb/vault.js";
import { SearchIndex } from "../search/index.js";

import { listNotesConfig, listNotesHandler } from "./tools/list-notes.js";
import { readNoteConfig, readNoteHandler } from "./tools/read-note.js";
import { searchNotesConfig, searchNotesHandler } from "./tools/search-notes.js";
import { createNoteConfig, createNoteHandler } from "./tools/create-note.js";
import { updateNoteConfig, updateNoteHandler } from "./tools/update-note.js";
import { appendToNoteConfig, appendToNoteHandler } from "./tools/append-to-note.js";
import { deleteNoteConfig, deleteNoteHandler } from "./tools/delete-note.js";
import {
  listRecentChangesConfig,
  listRecentChangesHandler,
} from "./tools/list-recent-changes.js";

export type ServerRuntime = Runtime.Runtime<Vault | SearchIndex>;

export const buildMcpServer = (runtime: ServerRuntime): McpServer => {
  const server = new McpServer(
    { name: "obsidian-mcp", version: "0.1.0" },
    {
      capabilities: { tools: {} },
      instructions:
        "Read, search, and edit the user's Obsidian vault. Notes are stored as markdown with optional YAML frontmatter. Prefer search_notes over list_notes when looking for content; prefer update_note over delete_note + create_note for in-place edits.",
    },
  );

  server.registerTool("list_notes", listNotesConfig, listNotesHandler(runtime));
  server.registerTool("read_note", readNoteConfig, readNoteHandler(runtime));
  server.registerTool("search_notes", searchNotesConfig, searchNotesHandler(runtime));
  server.registerTool("create_note", createNoteConfig, createNoteHandler(runtime));
  server.registerTool("update_note", updateNoteConfig, updateNoteHandler(runtime));
  server.registerTool("append_to_note", appendToNoteConfig, appendToNoteHandler(runtime));
  server.registerTool("delete_note", deleteNoteConfig, deleteNoteHandler(runtime));
  server.registerTool(
    "list_recent_changes",
    listRecentChangesConfig,
    listRecentChangesHandler(runtime),
  );

  return server;
};
