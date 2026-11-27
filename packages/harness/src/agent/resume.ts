import { isFunctionCall, type HistoryItem, type Usage } from "../model/types.js";
import type { TurnStatus } from "./store.js";

// Seen by the model when Nimbus closed in the middle of a turn
export const INTERRUPTED_NOTE = "[Nimbus closed before this reply finished.]";
export const INTERRUPTED_TOOL_OUTPUT =
  "Nimbus closed before this finished. It may have partly run, so check before running it again.";

// Seen by the model when an error ended a turn early
export const ERROR_NOTE = "[This reply stopped because of an error before it finished.]";
export const ERROR_TOOL_OUTPUT =
  "An error stopped this before it finished. It may have partly run, so check before running it again.";

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

// An output for every call that has none yet
export function openCallOutputs(items: HistoryItem[], output: string): HistoryItem[] {
  const answered = new Set(
    items.flatMap((item) => (item.type === "function_call_output" ? [item.call_id] : [])),
  );
  return items
    .filter(isFunctionCall)
    .filter((call) => !answered.has(call.call_id))
    .map((call) => ({ type: "function_call_output", call_id: call.call_id, output }));
}

// Close open calls, then add a note for the model
export function closeTurn(items: HistoryItem[], output: string, note: string): HistoryItem[] {
  return [...openCallOutputs(items, output), { role: "user", content: note }];
}

function endsWith(items: HistoryItem[], note: string): boolean {
  const last = items.at(-1) as { role?: string; content?: unknown } | undefined;
  return last?.role === "user" && last.content === note;
}

// History to send again after a resume
export function historyFromTurns(turns: SavedTurnItems[]): HistoryItem[] {
  return turns.flatMap((turn) => {
    // Encrypted reasoning may belong to another account or have expired
    const items = turn.items.filter((item) => (item as { type?: string }).type !== "reasoning");
    if (turn.status === "running") {
      return [...items, ...closeTurn(items, INTERRUPTED_TOOL_OUTPUT, INTERRUPTED_NOTE)];
    }
    if (turn.status === "failed" && !endsWith(items, ERROR_NOTE)) {
      return [...items, ...closeTurn(items, ERROR_TOOL_OUTPUT, ERROR_NOTE)];
    }
    return items;
  });
}
