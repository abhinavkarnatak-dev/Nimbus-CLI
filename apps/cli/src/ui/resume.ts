import {
  BUDGET_NOTE,
  ERROR_NOTE,
  historyFromTurns,
  INTERRUPTED_NOTE,
  isFunctionCall,
  parseSkillRequest,
  STOPPED_NOTE,
  VERIFY_REMINDER,
  type HistoryItem,
  type ResumeState,
} from "@nimbus/harness";
import type { SavedSession } from "../store/sqlite.js";
import { INIT_REQUEST } from "./commands.js";
import { CHECK_NOTICE, newId, type Item } from "./transcript.js";

const STOPPED_BY_ERROR = "This reply stopped because of an error.";

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
  const usage = { inputTokens: 0, cachedTokens: 0, cacheWriteTokens: 0, outputTokens: 0 };
  for (const turn of saved.turns) {
    usage.inputTokens += turn.usage.inputTokens;
    usage.cachedTokens += turn.usage.cachedTokens;
    usage.cacheWriteTokens += turn.usage.cacheWriteTokens;
    usage.outputTokens += turn.usage.outputTokens;
  }
  return {
    history: saved.compaction
      ? [
          ...saved.compaction.items,
          ...historyFromTurns(saved.turns.filter((turn) => turn.turn >= saved.compaction!.turn)),
        ]
      : historyFromTurns(saved.turns),
    turns: saved.turns.at(-1)?.turn ?? 0,
    title: saved.info.title,
    usage,
    cost: saved.turns.reduce((sum, turn) => sum + turn.cost, 0),
    fileChanges: saved.fileChanges,
    commandTurns: saved.turns
      .filter((turn) => turn.views.some((view) => view.name === "bash"))
      .map((turn) => turn.turn),
  };
}

// Rebuild what the screen showed, from the saved session
export function transcriptFrom(saved: SavedSession): Item[] {
  const items: Item[] = [];
  for (const turn of saved.turns) {
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
      } else if (text === ERROR_NOTE) {
        items.push({ kind: "notice", id: newId(), text: STOPPED_BY_ERROR, tone: "error" });
      } else if (text === INIT_REQUEST) {
        items.push({ kind: "user", id: newId(), text: "/init" });
      } else if (text === VERIFY_REMINDER) {
        items.push({ kind: "notice", id: newId(), text: CHECK_NOTICE, tone: "info" });
      } else if (text === BUDGET_NOTE) {
        items.push({ kind: "notice", id: newId(), text: "Stopped at the budget.", tone: "info" });
      } else if (text === INTERRUPTED_NOTE) {
        items.push({ kind: "notice", id: newId(), text: "Nimbus closed here.", tone: "info" });
      } else if (role === "user") {
        // A skill run shows as the /name the user typed
        items.push({ kind: "user", id: newId(), text: parseSkillRequest(text) ?? text });
      } else {
        items.push({ kind: "assistant", id: newId(), text });
      }
    }
    if (turn.status === "running") {
      items.push({ kind: "notice", id: newId(), text: "Nimbus closed here.", tone: "info" });
    }
    const last = turn.items.at(-1) as { content?: unknown } | undefined;
    if (turn.status === "failed" && last?.content !== ERROR_NOTE) {
      items.push({ kind: "notice", id: newId(), text: STOPPED_BY_ERROR, tone: "error" });
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
