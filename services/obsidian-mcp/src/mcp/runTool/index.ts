import { Cause, type Effect, Exit, Runtime } from "effect";
import type { ToolErrorPayload, ToolResult } from "../types.ts";

const renderError = (err: unknown): ToolErrorPayload => {
  if (err && typeof err === "object" && "_tag" in err) {
    const tag = String((err as { _tag: unknown })._tag);
    const fields = { ...(err as Record<string, unknown>) };
    delete (fields as { _tag?: unknown })._tag;
    const msg = "message" in err ? String((err as { message: unknown }).message) : tag;
    return { tag, message: msg, fields };
  }
  return { tag: "Unknown", message: err instanceof Error ? err.message : String(err) };
};

/**
 * Adapt an Effect-returning tool body to the shape the MCP SDK expects:
 * a plain async function that returns `{ content: [...] }`. Tagged errors
 * are routed to a structured error tool result rather than thrown, so
 * Claude sees a useful payload instead of a generic 500.
 *
 * Pattern: each per-tool handler captures the runtime once at registration
 * time and returns this adapter applied to its Effect body.
 *
 * @param runtime The Effect runtime captured at server boot.
 * @returns       A function that takes an Effect body and returns the
 *                async tool callback the MCP SDK invokes per request.
 */
export const runTool =
  <R>(runtime: Runtime.Runtime<R>) =>
  async <A>(eff: Effect.Effect<A, unknown, R>): Promise<ToolResult> => {
    const exit = await Runtime.runPromiseExit(runtime)(eff);
    if (Exit.isSuccess(exit)) {
      const value = exit.value;
      const out: ToolResult = {
        content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
      };
      // Wrap arrays in a `{ items: ... }` envelope so the SDK accepts
      // the structuredContent shape (it requires an object).
      if (Array.isArray(value)) {
        out.structuredContent = { items: value };
      } else if (value && typeof value === "object") {
        out.structuredContent = value as Record<string, unknown>;
      }
      return out;
    }
    const failure = Cause.failureOption(exit.cause);
    const payload = renderError(failure._tag === "Some" ? failure.value : Cause.squash(exit.cause));
    return {
      content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
      isError: true,
    };
  };
