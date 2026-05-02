import { describe, expect, it } from "vitest";
import { ConfigProvider, Effect, Redacted } from "effect";
import { liveSyncConfig } from "./index.ts";

describe("liveSyncConfig", () => {
  it("loads the passphrase as a redacted value", async () => {
    const out = await Effect.runPromise(
      liveSyncConfig.pipe(
        Effect.withConfigProvider(
          ConfigProvider.fromMap(new Map([["LIVESYNC_PASSPHRASE", "diceware-words"]])),
        ),
      ),
    );
    expect(Redacted.value(out.passphrase)).toBe("diceware-words");
    // Redacted shouldn't reveal the value via toString.
    expect(String(out.passphrase)).not.toContain("diceware-words");
  });
});
