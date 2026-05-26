import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    // bge-small inference and CouchDB live calls don't belong in unit tests;
    // such tests should mock at the layer boundary. Keep the timeout
    // tight so a hung mock blows up loudly.
    testTimeout: 10_000,
  },
});
