// Helpers for turning an Effect-returning tool body into the shape the MCP
// SDK expects: a plain async function returning `{ content: [...] }`. We
// route any tagged error to a structured error tool result rather than
// throwing, so Claude sees a useful message instead of a generic 500.

import { Cause, Effect, Exit, Runtime } from "effect";

export interface ToolErrorPayload {
  readonly tag: string;
  readonly message: string;
  readonly fields?: Record<string, unknown>;
}

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

// The MCP SDK's CallToolResult requires an index signature
// (`[x: string]: unknown`) so producers can attach extra protocol fields.
// We mirror that shape exactly.
export interface ToolResult {
  [x: string]: unknown;
  content: { type: "text"; text: string }[];
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
}

export const runTool =
  <R>(runtime: Runtime.Runtime<R>) =>
  async <A>(eff: Effect.Effect<A, unknown, R>): Promise<ToolResult> => {
    const exit = await Runtime.runPromiseExit(runtime)(eff);
    if (Exit.isSuccess(exit)) {
      const value = exit.value;
      const out: ToolResult = {
        content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
      };
      // Wrap arrays in a `{ items: ... }` envelope so the SDK accepts the
      // structuredContent shape (it requires an object, not a bare array).
      if (Array.isArray(value)) {
        out.structuredContent = { items: value };
      } else if (value && typeof value === "object") {
        out.structuredContent = value as Record<string, unknown>;
      }
      return out;
    }
    const failure = Cause.failureOption(exit.cause);
    const payload = renderError(
      failure._tag === "Some" ? failure.value : Cause.squash(exit.cause),
    );
    return {
      content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
      isError: true,
    };
  };
