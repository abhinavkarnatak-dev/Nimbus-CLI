import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ERROR_NOTE, STOPPED_NOTE, type HistoryItem } from "@nimbus/harness";
import { describe, expect, it } from "vitest";
import { openSessionStore, type SavedSession } from "../src/store/sqlite.js";
import { resumeStateFrom, timeAgo, transcriptFrom } from "../src/ui/resume.js";

const saved: SavedSession = {
  info: { id: "s", cwd: "/p", model: "gpt-6-luna", title: "fix it" },
  createdAt: 0,
  updatedAt: 0,
  turns: [
    {
      turn: 1,
      status: "done",
      items: [
        { role: "user", content: "fix it" },
        {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "Looking", annotations: [] }],
        } as unknown as HistoryItem,
        { type: "function_call", call_id: "c1", name: "read_file", arguments: '{"path":"a.ts"}' },
        { type: "function_call_output", call_id: "c1", output: "1 line" },
        { role: "assistant", content: "Fixed." },
      ],
      views: [
        {
          callId: "c1",
          name: "read_file",
          summary: "Read 1 line",
          isError: false,
          durationMs: 3,
        },
      ],
      usage: { inputTokens: 100, cachedTokens: 50, cacheWriteTokens: 0, outputTokens: 10 },
      cost: 0.01,
    },
    {
      turn: 2,
      status: "failed",
      items: [{ role: "user", content: "never seen" }],
      views: [],
      usage: { inputTokens: 5, cachedTokens: 0, cacheWriteTokens: 0, outputTokens: 0 },
      cost: 0.001,
    },
    {
      turn: 3,
      status: "cancelled",
      items: [
        { role: "user", content: "run tests" },
        { type: "function_call", call_id: "c2", name: "bash", arguments: '{"command":"npm test"}' },
        { type: "function_call_output", call_id: "c2", output: "stopped" },
        { role: "user", content: STOPPED_NOTE },
      ],
      views: [],
      usage: { inputTokens: 20, cachedTokens: 0, cacheWriteTokens: 0, outputTokens: 2 },
      cost: 0.002,
    },
  ],
  fileChanges: [],
  compaction: null,
};

describe("resume", () => {
  it("rebuilds the transcript the user saw", () => {
    const items = transcriptFrom(saved).map((item) => ({ ...item, id: 0 }));
    expect(items).toEqual([
      { kind: "user", id: 0, text: "fix it" },
      { kind: "assistant", id: 0, text: "Looking" },
      expect.objectContaining({
        kind: "tool",
        name: "read_file",
        status: "done",
        summary: "Read 1 line",
      }),
      { kind: "assistant", id: 0, text: "Fixed." },
      { kind: "user", id: 0, text: "never seen" },
      { kind: "notice", id: 0, text: "This reply stopped because of an error.", tone: "error" },
      { kind: "user", id: 0, text: "run tests" },
      expect.objectContaining({ kind: "tool", name: "bash", status: "error" }),
      { kind: "notice", id: 0, text: "Stopped by you.", tone: "info" },
    ]);
  });

  it("continues the turn count, adds up usage and keeps the failed turn with a note", () => {
    const state = resumeStateFrom(saved);
    expect(state.turns).toBe(3);
    expect(state.title).toBe("fix it");
    expect(state.usage).toEqual({
      inputTokens: 125,
      cachedTokens: 50,
      cacheWriteTokens: 0,
      outputTokens: 12,
    });
    expect(state.history).toContainEqual({ role: "user", content: ERROR_NOTE });
    expect(state.commandTurns).toEqual([]);
    expect(state.fileChanges).toEqual([]);
  });

  it("starts from the latest compaction and adds the turns after it", () => {
    const summary = { role: "user" as const, content: "[Summary] earlier work" };
    const state = resumeStateFrom({ ...saved, compaction: { turn: 3, items: [summary] } });
    expect(state.history[0]).toEqual(summary);
    expect(state.history).not.toContainEqual({ role: "user", content: "fix it" });
    expect(state.turns).toBe(3);
  });

  it("says how long ago in plain words", () => {
    const now = 10 * 24 * 3_600_000;
    expect(timeAgo(now - 30_000, now)).toBe("just now");
    expect(timeAgo(now - 5 * 60_000, now)).toBe("5 minutes ago");
    expect(timeAgo(now - 3_600_000, now)).toBe("1 hour ago");
    expect(timeAgo(now - 30 * 3_600_000, now)).toBe("yesterday");
    expect(timeAgo(now - 4 * 24 * 3_600_000, now)).toBe("4 days ago");
  });

  it("lists this folder's conversations, newest first", async () => {
    const store = openSessionStore(join(await mkdtemp(join(tmpdir(), "nimbus-list-")), "n.db"));
    const usage = { inputTokens: 0, cachedTokens: 0, cacheWriteTokens: 0, outputTokens: 0 };
    const add = (id: string, cwd: string, status: "done" | "failed") => {
      store.saveItems({ id, cwd, model: "m", title: id }, 1, [{ role: "user", content: id }]);
      store.endTurn(id, 1, status, usage, 0);
    };
    add("old", "/p", "done");
    await new Promise((resolve) => setTimeout(resolve, 5));
    add("other-folder", "/q", "done");
    add("failed-only", "/p", "failed");
    await new Promise((resolve) => setTimeout(resolve, 5));
    add("new", "/p", "done");
    expect(store.list("/p").map((s) => [s.id, s.turns])).toEqual([
      ["new", 1],
      ["failed-only", 1],
      ["old", 1],
    ]);
    store.close();
  });
});
