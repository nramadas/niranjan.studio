import { Effect } from "effect";
import { z } from "zod";
import { RecallClient } from "../../../meeting/RecallClient";
import { runTool } from "../../runTool";
import type { ServerRuntime } from "../../types.ts";

const inputShape = {
  bot_id: z.string().min(1).describe("The bot id returned by start_meeting_bot."),
} as const;

const config = {
  title: "Get meeting bot status",
  description:
    "Check the current status of a meeting bot (e.g. joining, in the call recording, or done). Use the bot id returned by start_meeting_bot.",
  inputSchema: inputShape,
};

const handler = (runtime: ServerRuntime) => async (args: { bot_id: string }) =>
  runTool(
    runtime,
    "get_meeting_bot",
  )(
    Effect.gen(function* () {
      const recall = yield* RecallClient;
      const bot = yield* recall.getBot(args.bot_id);
      return { bot_id: bot.id, status: bot.status ?? "unknown" };
    }),
  );

/** The `get_meeting_bot` MCP tool registration. */
export const getMeetingBot = (runtime: ServerRuntime) => ({
  name: "get_meeting_bot" as const,
  config,
  handler: handler(runtime),
});
