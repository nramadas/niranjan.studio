import { describe, expect, it } from "vitest";
import { ConfigProvider, Effect } from "effect";
import { searchConfig } from "./index.ts";

describe("searchConfig", () => {
  it("defaults the debounce to 5000ms", async () => {
    const out = await Effect.runPromise(
      searchConfig.pipe(Effect.withConfigProvider(ConfigProvider.fromMap(new Map()))),
    );
    expect(out.rebuildDebounceMs).toBe(5000);
  });

  it("accepts overrides via SEARCH_REBUILD_DEBOUNCE_MS", async () => {
    const out = await Effect.runPromise(
      searchConfig.pipe(
        Effect.withConfigProvider(
          ConfigProvider.fromMap(new Map([["SEARCH_REBUILD_DEBOUNCE_MS", "1500"]])),
        ),
      ),
    );
    expect(out.rebuildDebounceMs).toBe(1500);
  });
});
