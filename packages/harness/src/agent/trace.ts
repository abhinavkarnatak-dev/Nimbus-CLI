import type { ReasoningEffort } from "../models.js";
import type { Usage } from "../model/types.js";
import type { ToolView } from "./store.js";

export interface TracedTool {
  callId: string;
  name: string;
  args: string;
  // Null until the tool finished
  ok: boolean | null;
  durationMs: number | null;
}

// One model call, for /trace and evals
export interface ModelCall {
  turn: number;
  // Order within the turn, from 1
  step: number;
  // A summary is a compaction call
  kind: "reply" | "summary";
  model: string;
  effort: ReasoningEffort | null;
  usage: Usage;
  cost: number;
  // Includes waits between retries
  durationMs: number;
  retries: number;
  tools: TracedTool[];
}

// Saved calls get their tool results from the saved views
export function withToolViews(
  calls: readonly ModelCall[],
  views: readonly ToolView[],
): ModelCall[] {
  const byId = new Map(views.map((view) => [view.callId, view]));
  return calls.map((call) => ({
    ...call,
    tools: call.tools.map((tool) => {
      const view = byId.get(tool.callId);
      return view ? { ...tool, ok: !view.isError, durationMs: view.durationMs } : tool;
    }),
  }));
}
