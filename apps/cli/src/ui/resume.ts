import {
  historyFromTurns,
  INTERRUPTED_NOTE,
  isFunctionCall,
  STOPPED_NOTE,
  type HistoryItem,
  type ResumeState,
} from "@nimbus/harness";
import type { SavedSession } from "../store/sqlite.js";
import { newId, type Item } from "./transcript.js";

// Message text from either our own items or the API's output items
function textOf(item: HistoryItem): string | null {
  const { role, content } = item as { role?: string; content?: unknown };
  if (role !== "user" && role !== "assistant") return null;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return null;
  return content
    .map((part: { text?: unknown }) => (typeof part.text === "string" ? part.text : ""))
    .join("");
}

export function resumeStateFrom(saved: SavedSession): ResumeState {
  const usage = { inputTokens: 0, cachedTokens: 0, outputTokens: 0 };
  for (const turn of saved.turns) {
    usage.inputTokens += turn.usage.inputTokens;
    usage.cachedTokens += turn.usage.cachedTokens;
    usage.outputTokens += turn.usage.outputTokens;
  }
  return {
    history: historyFromTurns(saved.turns),
    turns: saved.turns.at(-1)?.turn ?? 0,
    title: saved.info.title,
    usage,
    cost: saved.turns.reduce((sum, turn) => sum + turn.cost, 0),
  };
}

// Rebuild what the screen showed, from the saved session
export function transcriptFrom(saved: SavedSession): Item[] {
  const items: Item[] = [];
  for (const turn of saved.turns) {
    if (turn.status === "failed") continue;
    const views = new Map(turn.views.map((view) => [view.callId, view]));
    for (const entry of turn.items) {
      if (isFunctionCall(entry)) {
        const view = views.get(entry.call_id);
        items.push({
          kind: "tool",
          id: newId(),
          callId: entry.call_id,
          name: entry.name,
          args: entry.arguments,
          status: view && !view.isError ? "done" : "error",
          startedAt: 0,
          summary: view?.summary ?? "Stopped before it finished",
          durationMs: view?.durationMs,
          diff: view?.diff,
          preview: view?.preview,
        });
        continue;
      }
      const text = textOf(entry);
      if (!text) continue;
      const { role } = entry as { role: string };
      if (text === STOPPED_NOTE) {
        items.push({ kind: "notice", id: newId(), text: "Stopped by you.", tone: "info" });
      } else if (text === INTERRUPTED_NOTE) {
        items.push({ kind: "notice", id: newId(), text: "Nimbus closed here.", tone: "info" });
      } else if (role === "user") {
        items.push({ kind: "user", id: newId(), text });
      } else {
        items.push({ kind: "assistant", id: newId(), text });
      }
    }
    if (turn.status === "running") {
      items.push({ kind: "notice", id: newId(), text: "Nimbus closed here.", tone: "info" });
    }
  }
  return items;
}

// "5 minutes ago", "yesterday", "3 days ago"
export function timeAgo(then: number, now = Date.now()): string {
  const minutes = Math.floor((now - then) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  return new Date(then).toLocaleDateString();
}
