import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Vault, type VaultImpl } from "@niranjan/vault-shared/couchdb";
import { Effect, Layer, ManagedRuntime } from "effect";
import { describe, expect, it } from "vitest";
import { RecallClient } from "../../meeting/RecallClient";
import { TranscriptionClient } from "../../meeting/TranscriptionClient";
import { IndexerClient } from "../../search/IndexerClient";
import { SearchIndex } from "../../search/SearchIndex";
import { buildMcpServer } from "./index.ts";

const stubVault: VaultImpl = {
  listNotes: () => Effect.succeed([]),
  listRecent: () => Effect.succeed([]),
  readNote: () => Effect.succeed({} as never),
  readNoteById: () => Effect.fail(new Error("stub")) as never,
  readAllForIndex: () => Effect.succeed([]),
  createNote: () => Effect.succeed({} as never),
  updateNote: () => Effect.succeed({} as never),
  appendToNote: () => Effect.succeed({} as never),
  editNote: () => Effect.succeed({} as never),
  deleteNote: () => Effect.void,
};

const stubSearch = {
  query: () => Effect.succeed([]),
  markDirty: () => Effect.void,
};

const stubIndexerClient = {
  search: () => Effect.succeed([]),
};

const stubRecallClient = {
  createBot: () => Effect.succeed({ id: "stub" }),
  getBot: () => Effect.succeed({ id: "stub" }),
  leaveCall: () => Effect.void,
  getRecording: () => Effect.succeed({ participants: [] }),
  deleteMedia: () => Effect.void,
};

const stubTranscriptionClient = {
  transcribe: () => Effect.succeed({ segments: [], modelName: "stub" }),
};

describe("buildMcpServer", () => {
  it("constructs an McpServer with all twelve tools registered", async () => {
    const layer = Layer.mergeAll(
      Layer.succeed(Vault, stubVault),
      Layer.succeed(SearchIndex, stubSearch),
      Layer.succeed(IndexerClient, stubIndexerClient),
      Layer.succeed(RecallClient, stubRecallClient),
      Layer.succeed(TranscriptionClient, stubTranscriptionClient),
    );
    const runtime = ManagedRuntime.make(layer);
    const inner = await runtime.runtime();
    const server = buildMcpServer(inner);
    expect(server).toBeInstanceOf(McpServer);
  });
});
