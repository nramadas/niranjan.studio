import { Effect } from "effect";
import { z } from "zod";
import { RecallClient } from "../../../meeting/RecallClient";
import { runTool } from "../../runTool";
import type { ServerRuntime } from "../../types.ts";

const inputShape = {
  bot_id: z.string().min(1).describe("The bot id returned by start_meeting_bot."),
} as const;

const config = {
  title: "Stop meeting bot",
  description:
    "Remove a meeting bot from its call — it stops recording and leaves. The recording finalizes and its transcript is still saved. (You can also remove the bot directly from the meeting's own participant list.)",
  inputSchema: inputShape,
};

const handler = (runtime: ServerRuntime) => async (args: { bot_id: string }) =>
  runTool(
    runtime,
    "stop_meeting_bot",
  )(
    Effect.gen(function* () {
      const recall = yield* RecallClient;
      yield* recall.leaveCall(args.bot_id);
      return { bot_id: args.bot_id, stopped: true };
    }),
  );

/** The `stop_meeting_bot` MCP tool registration. */
export const stopMeetingBot = (runtime: ServerRuntime) => ({
  name: "stop_meeting_bot" as const,
  config,
  handler: handler(runtime),
});
