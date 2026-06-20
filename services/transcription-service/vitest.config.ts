import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    // Network calls to Deepgram don't belong in unit tests; mock at the
    // layer boundary (e.g. globalThis.fetch) and test the pure mappers
    // directly. Keep the timeout tight so a hung mock blows up loudly.
    testTimeout: 10_000,
  },
});
