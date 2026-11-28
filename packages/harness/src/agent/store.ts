import type { ModelCall } from "./trace.js";
import type { FileChange } from "../tools/changes.js";
import type { HistoryItem, Usage } from "../model/types.js";

export interface SessionInfo {
  id: string;
  cwd: string;
  model: string;
  // First user message; stores keep the first one they see
  title: string;
}

export type TurnStatus = "done" | "cancelled" | "failed";

// What the screen showed for a finished tool call
export interface ToolView {
  callId: string;
  name: string;
  summary: string;
  isError: boolean;
  durationMs: number;
  diff?: string;
  preview?: string;
}

// Where sessions are saved after every step; the CLI uses SQLite
export interface SessionStore {
  saveItems(session: SessionInfo, turn: number, items: HistoryItem[]): void;
  saveToolView(sessionId: string, turn: number, view: ToolView): void;
  endTurn(sessionId: string, turn: number, status: TurnStatus, usage: Usage, cost: number): void;
  // Saved again after every write to the same file in a turn
  saveFileChange(sessionId: string, change: FileChange): void;
  // History before this turn was replaced by these items
  saveCompaction(sessionId: string, turn: number, items: HistoryItem[]): void;
  // One model call with its tokens, cost and time
  saveModelCall?(sessionId: string, call: ModelCall): void;
}

export interface MemoryTurn {
  items: HistoryItem[];
  views: ToolView[];
  status?: TurnStatus;
  usage?: Usage;
  cost?: number;
}

// In-memory store for tests
export class MemorySessionStore implements SessionStore {
  readonly sessions = new Map<string, { info: SessionInfo; turns: Map<number, MemoryTurn> }>();

  #turn(sessionId: string, turn: number): MemoryTurn {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Unknown session ${sessionId}`);
    let entry = session.turns.get(turn);
    if (!entry) {
      entry = { items: [], views: [] };
      session.turns.set(turn, entry);
    }
    return entry;
  }

  saveItems(session: SessionInfo, turn: number, items: HistoryItem[]): void {
    if (!this.sessions.has(session.id)) {
      this.sessions.set(session.id, { info: { ...session }, turns: new Map() });
    }
    this.#turn(session.id, turn).items.push(...structuredClone(items));
  }

  saveToolView(sessionId: string, turn: number, view: ToolView): void {
    this.#turn(sessionId, turn).views.push({ ...view });
  }

  endTurn(sessionId: string, turn: number, status: TurnStatus, usage: Usage, cost: number): void {
    Object.assign(this.#turn(sessionId, turn), { status, usage: { ...usage }, cost });
  }

  readonly fileChanges = new Map<string, FileChange[]>();
  readonly compactions = new Map<string, { turn: number; items: HistoryItem[] }>();

  saveCompaction(sessionId: string, turn: number, items: HistoryItem[]): void {
    this.compactions.set(sessionId, { turn, items: structuredClone(items) });
  }

  readonly calls = new Map<string, ModelCall[]>();

  saveModelCall(sessionId: string, call: ModelCall): void {
    this.calls.set(sessionId, [...(this.calls.get(sessionId) ?? []), structuredClone(call)]);
  }

  saveFileChange(sessionId: string, change: FileChange): void {
    const list = (this.fileChanges.get(sessionId) ?? []).filter(
      (saved) => !(saved.turn === change.turn && saved.path === change.path),
    );
    this.fileChanges.set(sessionId, [...list, { ...change }]);
  }
}
