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
      preview?: string;
    }
  | { type: "turn_complete"; usage: Usage; cost: number }
  | { type: "turn_cancelled" }
  | { type: "warning"; message: string }
  | { type: "notice"; message: string }
  // The model kept repeating a step, so the turn was ended
  | { type: "loop_stopped" }
  // The user said no to an action, so the turn ended
  | { type: "declined" }
  // The conversation is being shrunk, automatically or by /compact
  | { type: "compacting"; auto: boolean }
  | { type: "compacted"; before: number; after: number; summarized: boolean }
  // Paused before a model call; retry() continues after raising the budget
  | { type: "budget_reached"; spent: number; budget: number }
  // A model call failed and will be tried again after delayMs
  | {
      type: "retrying";
      attempt: number;
      maxRetries: number;
      delayMs: number;
      reason: string;
      restarted: boolean;
    }
  | { type: "error"; message: string; status?: number; code?: string };
