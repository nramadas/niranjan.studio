// Cross-cutting types used by runTool and buildMcpServer.

import type { Vault } from "@niranjan/vault-shared/couchdb";
import type { Runtime } from "effect";
import type { RecallClient } from "../meeting/RecallClient";
import type { TranscriptionClient } from "../meeting/TranscriptionClient";
import type { IndexerClient } from "../search/IndexerClient";
import type { SearchIndex } from "../search/SearchIndex";

/** The runtime type captured at server boot, with all tool deps resolved. */
export type ServerRuntime = Runtime.Runtime<
  Vault | SearchIndex | IndexerClient | RecallClient | TranscriptionClient
>;

/**
 * The MCP SDK's CallToolResult requires an index signature
 * (`[x: string]: unknown`) so producers can attach extra protocol fields.
 * We mirror that shape exactly.
 */
export interface ToolResult {
  [x: string]: unknown;
  content: { type: "text"; text: string }[];
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
}

/**
 * Normalised payload for a tagged-error tool failure. Goes into the
 * `content[0].text` of the tool result so Claude sees a structured
 * representation of what went wrong rather than an opaque exception.
 */
export interface ToolErrorPayload {
  readonly tag: string;
  readonly message: string;
  readonly fields?: Record<string, unknown>;
}
