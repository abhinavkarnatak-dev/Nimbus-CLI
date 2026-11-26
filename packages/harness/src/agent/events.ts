import type { Usage } from "../model/types.js";

export type AgentEvent =
  | { type: "text_delta"; text: string }
  | { type: "tool_call_start"; id: string; name: string; args: string }
  | {
      type: "tool_call_end";
      id: string;
      name: string;
      summary: string;
      isError: boolean;
      durationMs: number;
      diff?: string;
    }
  | { type: "turn_complete"; usage: Usage; cost: number }
  | { type: "turn_cancelled" }
  | { type: "error"; message: string };
