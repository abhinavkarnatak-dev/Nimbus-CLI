import { describe, expect, it } from "vitest";
import { FakeModelClient } from "../model/fake.js";
import type { HistoryItem } from "../model/types.js";
import { historyFromTurns, INTERRUPTED_NOTE, INTERRUPTED_TOOL_OUTPUT } from "./resume.js";
import { Session } from "./session.js";
import { MemorySessionStore } from "./store.js";

const call: HistoryItem = {
  type: "function_call",
  call_id: "c1",
  name: "bash",
  arguments: "{}",
};

describe("historyFromTurns", () => {
  it("skips failed turns, drops reasoning and closes a turn cut off by a crash", () => {
    const history = historyFromTurns([
      {
        status: "done",
        items: [
          { role: "user", content: "one" },
          { type: "reasoning", id: "r1", summary: [] } as HistoryItem,
          { role: "assistant", content: "ok" },
        ],
      },
      { status: "failed", items: [{ role: "user", content: "lost" }] },
      { status: "running", items: [{ role: "user", content: "run it" }, call] },
    ]);
    expect(history).toEqual([
      { role: "user", content: "one" },
      { role: "assistant", content: "ok" },
      { role: "user", content: "run it" },
      call,
      { type: "function_call_output", call_id: "c1", output: INTERRUPTED_TOOL_OUTPUT },
      { role: "user", content: INTERRUPTED_NOTE },
    ]);
  });
});

describe("Session resume", () => {
  it("sends the saved history and keeps counting turns, title and usage", async () => {
    const client = new FakeModelClient([{ text: "welcome back", usage: { inputTokens: 5 } }]);
    const store = new MemorySessionStore();
    const session = new Session({
      client,
      model: "gpt-6-luna",
      instructions: "test",
      cwd: "/p",
      id: "old",
      store,
      resume: {
        history: [
          { role: "user", content: "earlier" },
          { role: "assistant", content: "sure" },
        ],
        turns: 3,
        title: "earlier",
        usage: { inputTokens: 100, cachedTokens: 0, outputTokens: 10 },
        cost: 0.5,
      },
    });
    for await (const _event of session.send("again")) void _event;

    expect(client.requests[0]!.input).toEqual([
      { role: "user", content: "earlier" },
      { role: "assistant", content: "sure" },
      { role: "user", content: "again" },
    ]);
    expect(client.requests[0]!.promptCacheKey).toBe("old");
    const saved = store.sessions.get("old")!;
    expect([...saved.turns.keys()]).toEqual([4]);
    expect(saved.info.title).toBe("earlier");
    expect(session.usage.inputTokens).toBe(105);
    expect(session.cost).toBeGreaterThanOrEqual(0.5);
  });
});
