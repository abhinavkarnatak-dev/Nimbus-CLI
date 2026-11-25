import type { Usage } from "../model/types.js";

export type AgentEvent =
  | { type: "text_delta"; text: string }
  | { type: "turn_complete"; usage: Usage; cost: number }
  | { type: "turn_cancelled" }
  | { type: "error"; message: string };
