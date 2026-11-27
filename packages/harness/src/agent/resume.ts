import { isFunctionCall, type HistoryItem, type Usage } from "../model/types.js";
import type { TurnStatus } from "./store.js";

// Seen by the model when Nimbus closed in the middle of a turn
export const INTERRUPTED_NOTE = "[Nimbus closed before this reply finished.]";
export const INTERRUPTED_TOOL_OUTPUT =
  "Nimbus closed before this finished. It may have partly run, so check before running it again.";

export interface ResumeState {
  history: HistoryItem[];
  turns: number;
  title: string;
  usage: Usage;
  cost: number;
}

export interface SavedTurnItems {
  status: TurnStatus | "running";
  items: HistoryItem[];
}

// Give every unanswered call an output, then add a note
export function closeTurn(items: HistoryItem[], output: string, note: string): HistoryItem[] {
  const answered = new Set(
    items.flatMap((item) => (item.type === "function_call_output" ? [item.call_id] : [])),
  );
  const missing: HistoryItem[] = items
    .filter(isFunctionCall)
    .filter((call) => !answered.has(call.call_id))
    .map((call) => ({ type: "function_call_output", call_id: call.call_id, output }));
  return [...missing, { role: "user", content: note }];
}

// History to send again after a resume
export function historyFromTurns(turns: SavedTurnItems[]): HistoryItem[] {
  return turns.flatMap((turn) => {
    if (turn.status === "failed") return [];
    // Encrypted reasoning may belong to another account or have expired
    const items = turn.items.filter((item) => (item as { type?: string }).type !== "reasoning");
    if (turn.status !== "running") return items;
    return [...items, ...closeTurn(items, INTERRUPTED_TOOL_OUTPUT, INTERRUPTED_NOTE)];
  });
}
