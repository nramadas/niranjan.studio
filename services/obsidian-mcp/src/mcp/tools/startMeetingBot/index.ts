import { Effect } from "effect";
import { z } from "zod";
import { RecallClient } from "../../../meeting/RecallClient";
import { runTool } from "../../runTool";
import type { ServerRuntime } from "../../types.ts";

const inputShape = {
  meeting_url: z
    .string()
    .url()
    .describe("Meeting URL to send the bot to (Zoom, Google Meet, or Microsoft Teams)."),
  note_title: z
    .string()
    .optional()
    .describe('Title for the saved transcript note. Defaults to "Meeting" if omitted.'),
} as const;

const config = {
  title: "Start meeting bot",
  description:
    "Dispatch a meeting bot to join a video call by URL and record its audio. The bot joins as a visible, named participant. When the call ends, a diarized transcript is saved to the vault under the Meetings/ folder and becomes searchable. Returns the bot id — keep it for stop_meeting_bot or get_meeting_bot.",
  inputSchema: inputShape,
};

const handler =
  (runtime: ServerRuntime) => async (args: { meeting_url: string; note_title?: string }) =>
    runTool(
      runtime,
      "start_meeting_bot",
    )(
      Effect.gen(function* () {
        const recall = yield* RecallClient;
        const bot = yield* recall.createBot({
          meetingUrl: args.meeting_url,
          // dispatched_at gives the webhook a stable date for the note path
          // (deterministic across Svix retries) and the meeting start time.
          metadata: { note_title: args.note_title ?? "", dispatched_at: new Date().toISOString() },
        });
        return { bot_id: bot.id, status: bot.status ?? "dispatched" };
      }),
    );

/** The `start_meeting_bot` MCP tool registration. */
export const startMeetingBot = (runtime: ServerRuntime) => ({
  name: "start_meeting_bot" as const,
  config,
  handler: handler(runtime),
});
