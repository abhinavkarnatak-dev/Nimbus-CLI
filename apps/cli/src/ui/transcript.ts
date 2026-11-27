import type { AgentEvent } from "@nimbus/harness";

export type Item =
  | { kind: "header"; id: number }
  | { kind: "user"; id: number; text: string }
  | { kind: "assistant"; id: number; text: string; continued?: boolean }
  | {
      kind: "tool";
      id: number;
      callId: string;
      name: string;
      args: string;
      status: "running" | "done" | "error";
      startedAt: number;
      summary?: string;
      durationMs?: number;
      diff?: string;
      preview?: string;
    }
  | { kind: "notice"; id: number; text: string; tone: "info" | "error" };

export const RESTARTED_NOTICE = "Connection dropped mid-reply, starting the reply again.";

let nextId = 1;
export const newId = () => nextId++;

// Fold one agent event into the live items
export function applyEvent(items: Item[], event: AgentEvent, now = Date.now()): Item[] {
  switch (event.type) {
    case "text_delta": {
      const last = items.at(-1);
      if (last?.kind === "assistant") {
        return [...items.slice(0, -1), { ...last, text: last.text + event.text }];
      }
      return [...items, { kind: "assistant", id: newId(), text: event.text }];
    }
    case "tool_call_start":
      return [
        ...items,
        {
          kind: "tool",
          id: newId(),
          callId: event.id,
          name: event.name,
          args: event.args,
          status: "running",
          startedAt: now,
        },
      ];
    case "tool_call_end":
      return items.map((item) =>
        item.kind === "tool" && item.callId === event.id
          ? {
              ...item,
              status: event.isError ? "error" : "done",
              summary: event.summary,
              durationMs: event.durationMs,
              diff: event.diff,
              preview: event.preview,
            }
          : item,
      );
    case "turn_cancelled":
      return [...items, { kind: "notice", id: newId(), text: "Stopped by you.", tone: "info" }];
    case "error":
    case "warning":
      return [...items, { kind: "notice", id: newId(), text: event.message, tone: "error" }];
    case "retrying":
      // The half-shown reply stays, the new one starts below it
      return event.restarted
        ? [...items, { kind: "notice", id: newId(), text: RESTARTED_NOTICE, tone: "info" }]
        : items;
    case "compacted": {
      const tokens = (n: number) => n.toLocaleString("en-US");
      const how = event.summarized ? "" : " (old tool outputs removed)";
      const text = `Conversation compacted: ${tokens(event.before)} → ${tokens(event.after)} tokens${how}`;
      return [...items, { kind: "notice", id: newId(), text, tone: "info" }];
    }
    case "budget_reached":
      return [
        ...items,
        {
          kind: "notice",
          id: newId(),
          text: `This session reached its $${event.budget.toFixed(2)} budget.`,
          tone: "info",
        },
      ];
    case "notice":
      return [...items, { kind: "notice", id: newId(), text: event.message, tone: "info" }];
    case "compacting":
    case "turn_complete":
      return items;
  }
}

// Last paragraph break outside a code fence
function safeSplitPoint(text: string): number {
  let inFence = false;
  let split = -1;
  let index = 0;
  for (const line of text.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    index += line.length + 1;
    if (!inFence && line.trim() === "" && index < text.length) split = index;
  }
  return split;
}

// Items that will not change again
export function settle(items: Item[]): { done: Item[]; live: Item[] } {
  const done: Item[] = [];
  let i = 0;
  for (; i < items.length; i++) {
    const item = items[i]!;
    const isLast = i === items.length - 1;
    if (item.kind === "tool" && item.status === "running") break;
    if (item.kind === "assistant" && isLast) {
      const split = safeSplitPoint(item.text);
      if (split > 0) {
        done.push({ ...item, text: item.text.slice(0, split).trimEnd() });
        return {
          done,
          live: [{ kind: "assistant", id: newId(), text: item.text.slice(split), continued: true }],
        };
      }
      break;
    }
    done.push(item);
  }
  return { done, live: items.slice(i) };
}
