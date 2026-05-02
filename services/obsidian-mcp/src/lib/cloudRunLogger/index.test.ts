import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Effect, Logger, LogLevel } from "effect";
import { cloudRunLogger } from "./index.ts";

describe("cloudRunLogger", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it("emits one JSON line per log call with a severity field", async () => {
    await Effect.runPromise(
      Effect.logInfo("hello").pipe(
        Effect.provide(Logger.replace(Logger.defaultLogger, cloudRunLogger)),
        Logger.withMinimumLogLevel(LogLevel.Info),
      ),
    );
    expect(logSpy).toHaveBeenCalledOnce();
    const line = logSpy.mock.calls[0]?.[0] as string;
    const parsed = JSON.parse(line);
    expect(parsed.severity).toBe("INFO");
    expect(parsed.message).toBe("hello");
    expect(typeof parsed.timestamp).toBe("string");
  });

  it("maps Effect log levels to Cloud Logging severities", async () => {
    await Effect.runPromise(
      Effect.logError("boom").pipe(
        Effect.provide(Logger.replace(Logger.defaultLogger, cloudRunLogger)),
        Logger.withMinimumLogLevel(LogLevel.Debug),
      ),
    );
    const line = logSpy.mock.calls[0]?.[0] as string;
    const parsed = JSON.parse(line);
    expect(parsed.severity).toBe("ERROR");
  });
});
