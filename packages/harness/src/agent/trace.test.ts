import { describe, expect, it } from "vitest";
import { z } from "zod";
import { FakeModelClient } from "../model/fake.js";
import { effortFor, MODELS } from "../models.js";
import { MODEL_PRICES } from "../cost.js";
import { defineTool } from "../tools/types.js";
import type { AgentEvent } from "./events.js";
import { Session } from "./session.js";
import { MemorySessionStore } from "./store.js";
import { withToolViews } from "./trace.js";

async function drain(events: AsyncIterable<AgentEvent>): Promise<void> {
  for await (const _event of events) void _event;
}

const echoTool = defineTool({
  name: "echo",
  description: "Echo text back.",
  schema: z.strictObject({ text: z.string() }),
  async run({ text }) {
    if (text === "fail") throw new Error("broken");
    return { output: `echo: ${text}`, summary: "echoed" };
  },
});

describe("models and reasoning level", () => {
  it("prices every model and keeps levels each model accepts", () => {
    for (const model of MODELS) expect(MODEL_PRICES[model.id]).toBeDefined();
    expect(effortFor("gpt-6.2-astra", "none")).toBe("medium");
    expect(effortFor("gpt-6-luna", "none")).toBe("none");
    expect(effortFor("gpt-6.2-sol", undefined)).toBe("medium");
  });

  it("sends the level, and a new model forgets the old reasoning", async () => {
    const client = new FakeModelClient([{ text: "one" }, { text: "two" }]);
    const session = new Session({
      client,
      model: "gpt-6-luna",
      effort: "high",
      instructions: "t",
      cwd: process.cwd(),
      resume: {
        history: [
          { role: "user", content: "hi" },
          { type: "reasoning", id: "r1", summary: [], encrypted_content: "x" },
          { role: "assistant", content: "hello" },
        ],
        turns: 1,
        title: "hi",
        usage: { inputTokens: 0, cachedTokens: 0, cacheWriteTokens: 0, outputTokens: 0 },
        cost: 0,
      },
    });
    await drain(session.send("a"));
    expect(client.requests[0]!.effort).toBe("high");
    session.setModel("gpt-6-luna", "low");
    expect(session.history.some((item) => (item as { type?: string }).type === "reasoning")).toBe(
      true,
    );
    session.setModel("gpt-6.2-sol", "max");
    expect(session.history.some((item) => (item as { type?: string }).type === "reasoning")).toBe(
      false,
    );
    await drain(session.send("b"));
    expect(client.requests[1]!.model).toBe("gpt-6.2-sol");
    expect(client.requests[1]!.effort).toBe("max");
  });
});

describe("trace", () => {
  it("records every model call with its tools, and saves it", async () => {
    const store = new MemorySessionStore();
    const client = new FakeModelClient([
      {
        toolCalls: [
          { name: "echo", args: { text: "a" } },
          { name: "echo", args: { text: "fail" } },
        ],
        usage: { inputTokens: 1000, cachedTokens: 800, outputTokens: 50 },
      },
      { text: "done", usage: { inputTokens: 1200, outputTokens: 20 } },
    ]);
    const session = new Session({
      client,
      model: "gpt-6-luna",
      effort: "medium",
      instructions: "t",
      cwd: process.cwd(),
      tools: [echoTool],
      id: "s1",
      store,
    });
    await drain(session.send("go"));
    const trace = session.trace()!;
    expect(trace.turn).toBe(1);
    expect(trace.calls.map((call) => [call.step, call.kind, call.model, call.effort])).toEqual([
      [1, "reply", "gpt-6-luna", "medium"],
      [2, "reply", "gpt-6-luna", "medium"],
    ]);
    expect(trace.calls[0]!.usage.cachedTokens).toBe(800);
    expect(trace.calls[0]!.cost).toBeGreaterThan(0);
    expect(trace.calls[0]!.tools.map((tool) => [tool.name, tool.ok])).toEqual([
      ["echo", true],
      ["echo", false],
    ]);
    expect(trace.calls[1]!.tools).toEqual([]);
    expect(session.trace(5)).toBeNull();

    // Saved before tools ran; views fill them in after a resume
    const saved = store.calls.get("s1")!;
    expect(saved).toHaveLength(2);
    expect(saved[0]!.tools[0]!.ok).toBeNull();
    const views = store.sessions.get("s1")!.turns.get(1)!.views;
    expect(withToolViews(saved, views)[0]!.tools.map((tool) => tool.ok)).toEqual([true, false]);
  });

  it("puts a /compact summary under the reply before it", async () => {
    const client = new FakeModelClient([{ text: "ok" }, { text: "Summary of the chat" }]);
    const session = new Session({
      client,
      model: "gpt-6-luna",
      instructions: "t",
      cwd: process.cwd(),
    });
    await drain(session.send("word ".repeat(3000)));
    await drain(session.compact());
    expect(session.trace()!.calls.map((call) => [call.turn, call.step, call.kind])).toEqual([
      [1, 1, "reply"],
      [1, 2, "summary"],
    ]);
  });
});
