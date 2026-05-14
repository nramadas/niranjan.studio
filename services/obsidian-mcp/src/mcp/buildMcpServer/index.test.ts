import { describe, expect, it } from "vitest";
import { Effect, Layer, ManagedRuntime } from "effect";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { buildMcpServer } from "./index.ts";
import { Vault, type VaultImpl } from "../../couchdb/Vault";
import { SearchIndex } from "../../search/SearchIndex";

const stubVault: VaultImpl = {
  listNotes: () => Effect.succeed([]),
  listRecent: () => Effect.succeed([]),
  readNote: () => Effect.succeed({} as never),
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

describe("buildMcpServer", () => {
  it("constructs an McpServer with all nine tools registered", async () => {
    const layer = Layer.merge(Layer.succeed(Vault, stubVault), Layer.succeed(SearchIndex, stubSearch));
    const runtime = ManagedRuntime.make(layer);
    const inner = await runtime.runtime();
    const server = buildMcpServer(inner);
    expect(server).toBeInstanceOf(McpServer);
  });
});
