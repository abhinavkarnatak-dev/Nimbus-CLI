import { describe, expect, it } from "vitest";
import { z } from "zod";
import { FakeModelClient } from "../model/fake.js";
import { defineTool } from "../tools/types.js";
import type { AgentEvent } from "./events.js";
import { Session, STOPPED_NOTE, STOPPED_TOOL_OUTPUT } from "./session.js";
import { ERROR_NOTE } from "./resume.js";
import { MemorySessionStore, type SessionStore } from "./store.js";

async function collect(events: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const all: AgentEvent[] = [];
  for await (const event of events) all.push(event);
  return all;
}

function textOf(events: AgentEvent[]): string {
  return events.map((event) => (event.type === "text_delta" ? event.text : "")).join("");
}

const echoTool = defineTool({
  name: "echo",
  description: "Echo text back.",
  schema: z.strictObject({ text: z.string() }),
  async run({ text }) {
    return { output: `echo: ${text}`, summary: "echoed" };
  },
});

const slowTool = defineTool({
  name: "slow",
  description: "Waits until aborted.",
  schema: z.strictObject({}),
  async run(_input, ctx) {
    await new Promise((_resolve, reject) => {
      ctx.signal.addEventListener("abort", () => reject(ctx.signal.reason), { once: true });
    });
    return { output: "never" };
  },
});

function newSession(client: FakeModelClient, maxSteps?: number, store?: SessionStore): Session {
  return new Session({
    client,
    model: "gpt-6-luna",
    instructions: "test prompt",
    cwd: process.cwd(),
    tools: [echoTool, slowTool],
    maxSteps,
    id: "s1",
    store,
  });
}

describe("Session", () => {
  it("streams text deltas in order and ends with turn_complete", async () => {
    const session = newSession(new FakeModelClient([{ text: "Hello there friend" }]));
    const events = await collect(session.send("hi"));

    expect(events.filter((event) => event.type === "text_delta").length).toBeGreaterThan(1);
    expect(textOf(events)).toBe("Hello there friend");
    expect(events.at(-1)?.type).toBe("turn_complete");
  });

  it("sends the full history on every turn", async () => {
    const client = new FakeModelClient([{ text: "Hi Abhinav" }, { text: "Your name is Abhinav" }]);
    const session = newSession(client);

    await collect(session.send("my name is Abhinav"));
    await collect(session.send("what is my name?"));

    expect(client.requests[1]?.input).toEqual([
      { role: "user", content: "my name is Abhinav" },
      { role: "assistant", content: "Hi Abhinav" },
      { role: "user", content: "what is my name?" },
    ]);
    expect(session.history).toHaveLength(4);
  });

  it("passes instructions, model and the session id as cache key", async () => {
    const client = new FakeModelClient([{ text: "ok" }]);
    await collect(newSession(client).send("hi"));

    expect(client.requests[0]).toMatchObject({
      model: "gpt-6-luna",
      instructions: "test prompt",
      promptCacheKey: "s1",
    });
  });

  it("adds up usage and cost across turns", async () => {
    const usage = { inputTokens: 1_000_000, cachedTokens: 0, outputTokens: 1_000_000 };
    const session = newSession(
      new FakeModelClient([
        { text: "a", usage },
        { text: "b", usage },
      ]),
    );

    await collect(session.send("one"));
    await collect(session.send("two"));

    expect(session.usage).toEqual({
      inputTokens: 2_000_000,
      cachedTokens: 0,
      outputTokens: 2_000_000,
    });
    expect(session.cost).toBeCloseTo(1.2);
  });

  it("passes the error code too, for example insufficient_quota", async () => {
    const session = newSession(
      new FakeModelClient([{ error: "No credit", status: 429, code: "insufficient_quota" }]),
    );
    const events = await collect(session.send("hi"));
    expect(events).toEqual([
      { type: "error", message: "No credit", status: 429, code: "insufficient_quota" },
    ]);
  });

  it("drops encrypted reasoning from history and keeps the rest", async () => {
    const session = newSession(new FakeModelClient([{ text: "hello" }]));
    await collect(session.send("hi"));
    (session.history as unknown[]).push({ type: "reasoning", encrypted_content: "x" });
    session.forgetReasoning();
    expect(session.history.some((item) => (item as { type?: string }).type === "reasoning")).toBe(
      false,
    );
    expect(session.history.length).toBe(2);
  });

  it("passes the HTTP status of a failed call on the error event", async () => {
    const session = newSession(new FakeModelClient([{ error: "Invalid token", status: 401 }]));
    const events = await collect(session.send("hi"));
    expect(events).toEqual([{ type: "error", message: "Invalid token", status: 401 }]);
  });

  it("turns model errors into an error event and keeps history unchanged", async () => {
    const session = newSession(new FakeModelClient([{ error: "rate limited" }]));
    const events = await collect(session.send("hi"));

    expect(events).toEqual([{ type: "error", message: "rate limited" }]);
    expect(session.history).toHaveLength(0);
  });

  it("stops on abort and keeps the message with a note that the user stopped", async () => {
    const session = newSession(new FakeModelClient([{ text: "one two three four five" }]));
    const controller = new AbortController();
    const events: AgentEvent[] = [];

    for await (const event of session.send("hi", controller.signal)) {
      events.push(event);
      if (event.type === "text_delta") controller.abort();
    }

    expect(events.at(-1)).toEqual({ type: "turn_cancelled" });
    expect(textOf(events)).toBe("one ");
    expect(session.history).toEqual([
      { role: "user", content: "hi" },
      { role: "user", content: STOPPED_NOTE },
    ]);
  });

  describe("tool loop", () => {
    it("runs a tool and sends its output back with the same call_id", async () => {
      const client = new FakeModelClient([
        { toolCalls: [{ name: "echo", args: { text: "hi" } }] },
        { text: "done" },
      ]);
      const events = await collect(newSession(client).send("use echo"));

      expect(events.map((event) => event.type)).toEqual([
        "tool_call_start",
        "tool_call_end",
        "text_delta",
        "turn_complete",
      ]);
      expect(client.requests[1]?.input.slice(-2)).toEqual([
        { type: "function_call", call_id: "call_1", name: "echo", arguments: '{"text":"hi"}' },
        { type: "function_call_output", call_id: "call_1", output: "echo: hi" },
      ]);
    });

    it("sends the tools to the model", async () => {
      const client = new FakeModelClient([{ text: "ok" }]);
      await collect(newSession(client).send("hi"));

      const tools = client.requests[0]?.tools ?? [];
      expect(tools.map((tool) => tool.name)).toEqual(["echo", "slow"]);
      expect(tools[0]?.parameters).toMatchObject({
        type: "object",
        properties: { text: { type: "string" } },
        required: ["text"],
        additionalProperties: false,
      });
    });

    it("runs every call when the model asks for several", async () => {
      const client = new FakeModelClient([
        {
          toolCalls: [
            { name: "echo", args: { text: "a" } },
            { name: "echo", args: { text: "b" } },
          ],
        },
        { text: "done" },
      ]);
      await collect(newSession(client).send("two"));

      const outputs = client.requests[1]?.input.filter(
        (item) => item.type === "function_call_output",
      );
      expect(outputs).toEqual([
        { type: "function_call_output", call_id: "call_1", output: "echo: a" },
        { type: "function_call_output", call_id: "call_2", output: "echo: b" },
      ]);
    });

    it("returns errors to the model instead of crashing", async () => {
      const client = new FakeModelClient([
        {
          toolCalls: [
            { name: "missing", args: {} },
            { name: "echo", args: '{"text": "broken' },
            { name: "echo", args: { text: 5 } },
          ],
        },
        { text: "sorry" },
      ]);
      const events = await collect(newSession(client).send("break things"));

      const ends = events.filter((event) => event.type === "tool_call_end");
      expect(ends.every((event) => event.type === "tool_call_end" && event.isError)).toBe(true);
      const outputs = (client.requests[1]?.input ?? [])
        .filter((item) => item.type === "function_call_output")
        .map((item) => (item.type === "function_call_output" ? String(item.output) : ""));
      expect(outputs[0]).toContain('unknown tool "missing"');
      expect(outputs[1]).toContain("not valid JSON");
      expect(outputs[2]).toContain("invalid arguments");
      expect(events.at(-1)?.type).toBe("turn_complete");
    });

    it("stops after the step limit and keeps the turn in history", async () => {
      const call = { toolCalls: [{ name: "echo", args: { text: "again" } }] };
      const session = newSession(new FakeModelClient([call, call, call]), 2);
      const events = await collect(session.send("loop forever"));

      expect(events.at(-1)).toMatchObject({ type: "error" });
      expect(session.history.length).toBeGreaterThan(1);
    });

    it("counts usage from every model call in the turn", async () => {
      const usage = { inputTokens: 100, cachedTokens: 0, outputTokens: 10 };
      const session = newSession(
        new FakeModelClient([
          { toolCalls: [{ name: "echo", args: { text: "x" } }], usage },
          { text: "done", usage },
        ]),
      );
      const events = await collect(session.send("go"));

      expect(events.at(-1)).toMatchObject({
        type: "turn_complete",
        usage: { inputTokens: 200, outputTokens: 20 },
      });
    });

    it("cancels a running tool and tells the model it may have partly run", async () => {
      const session = newSession(
        new FakeModelClient([{ toolCalls: [{ name: "slow", args: {} }] }]),
      );
      const controller = new AbortController();
      const events: AgentEvent[] = [];

      for await (const event of session.send("wait", controller.signal)) {
        events.push(event);
        if (event.type === "tool_call_start") setTimeout(() => controller.abort(), 5);
      }

      expect(events.at(-1)).toEqual({ type: "turn_cancelled" });
      expect(session.history).toEqual([
        { role: "user", content: "wait" },
        expect.objectContaining({ type: "function_call", call_id: "call_1", name: "slow" }),
        { type: "function_call_output", call_id: "call_1", output: STOPPED_TOOL_OUTPUT },
        { role: "user", content: STOPPED_NOTE },
      ]);
    });
  });

  describe("failed turns", () => {
    function counter() {
      let runs = 0;
      const tool = defineTool({
        name: "count",
        description: "Counts how often it runs.",
        schema: z.strictObject({}),
        async run() {
          runs++;
          return { output: `ran ${runs}`, summary: "counted" };
        },
      });
      return { tool, runs: () => runs };
    }

    it("retry() continues from the last finished step without running tools again", async () => {
      const { tool, runs } = counter();
      const client = new FakeModelClient([
        { toolCalls: [{ name: "count", args: {} }] },
        { error: "Your Nimbus trial credit is used up ($0.50).", status: 402 },
        { text: "Finished on your key" },
      ]);
      const store = new MemorySessionStore();
      const session = new Session({
        client,
        model: "gpt-6-luna",
        instructions: "test",
        cwd: process.cwd(),
        tools: [tool],
        id: "s1",
        store,
      });
      const first = await collect(session.send("do it"));
      expect(first.at(-1)).toMatchObject({ type: "error", status: 402 });
      expect(session.canRetry).toBe(true);
      expect(session.history).toHaveLength(0);

      const second = await collect(session.retry());
      expect(second.at(-1)?.type).toBe("turn_complete");
      expect(runs()).toBe(1);
      expect(client.requests[2]!.input).toEqual([
        { role: "user", content: "do it" },
        expect.objectContaining({ type: "function_call", name: "count" }),
        { type: "function_call_output", call_id: "call_1", output: "ran 1" },
      ]);
      expect(session.history.filter((item) => "role" in item && item.role === "user")).toHaveLength(
        1,
      );
      expect(session.canRetry).toBe(false);
      expect(store.sessions.get("s1")!.turns.get(1)!.status).toBe("done");
    });

    it("keeps a failed turn in history with a note when the user moves on", async () => {
      const { tool } = counter();
      const client = new FakeModelClient([
        { toolCalls: [{ name: "count", args: {} }] },
        { error: "network down" },
        { text: "ok" },
      ]);
      const session = new Session({
        client,
        model: "gpt-6-luna",
        instructions: "test",
        cwd: process.cwd(),
        tools: [tool],
      });
      await collect(session.send("first"));
      await collect(session.send("second"));
      expect(client.requests[2]!.input).toEqual([
        { role: "user", content: "first" },
        expect.objectContaining({ type: "function_call" }),
        { type: "function_call_output", call_id: "call_1", output: "ran 1" },
        { role: "user", content: ERROR_NOTE },
        { role: "user", content: "second" },
      ]);
      expect(session.canRetry).toBe(false);
    });

    it("drops reasoning from a failed turn when switching accounts", async () => {
      const client = new FakeModelClient([{ error: "x" }]);
      const session = newSession(client);
      await collect(session.send("hi"));
      session.forgetReasoning();
      expect(session.canRetry).toBe(true);
    });

    it("says so when there is nothing to retry", async () => {
      const session = newSession(new FakeModelClient([]));
      expect(await collect(session.retry())).toEqual([
        { type: "error", message: "There is no failed reply to continue." },
      ]);
    });

    it("never runs a call id twice, even after a resume", async () => {
      const { tool, runs } = counter();
      const session = new Session({
        client: new FakeModelClient([{ toolCalls: [{ name: "count", args: {} }] }, { text: "ok" }]),
        model: "gpt-6-luna",
        instructions: "test",
        cwd: process.cwd(),
        tools: [tool],
        resume: {
          history: [
            { role: "user", content: "before" },
            { type: "function_call", call_id: "call_1", name: "count", arguments: "{}" },
            { type: "function_call_output", call_id: "call_1", output: "ran earlier" },
          ],
          turns: 1,
          title: "before",
          usage: { inputTokens: 0, cachedTokens: 0, outputTokens: 0 },
          cost: 0,
        },
      });
      const events = await collect(session.send("again"));
      expect(runs()).toBe(0);
      expect(events).toContainEqual(
        expect.objectContaining({
          type: "tool_call_end",
          summary: "Already ran, reused the earlier result",
        }),
      );
    });
  });

  describe("saving", () => {
    it("saves every step, the tool view and how the turn ended", async () => {
      const store = new MemorySessionStore();
      const session = newSession(
        new FakeModelClient([
          { toolCalls: [{ name: "echo", args: { text: "hi" } }], usage: { inputTokens: 10 } },
          { text: "All done", usage: { inputTokens: 20, outputTokens: 5 } },
        ]),
        undefined,
        store,
      );
      await collect(session.send("  say hi  "));

      const saved = store.sessions.get("s1")!;
      expect(saved.info).toEqual({
        id: "s1",
        cwd: process.cwd(),
        model: "gpt-6-luna",
        title: "say hi",
      });
      const turn = saved.turns.get(1)!;
      expect(turn.items).toEqual(session.history);
      expect(turn.views).toEqual([
        expect.objectContaining({ callId: "call_1", name: "echo", summary: "echoed" }),
      ]);
      expect(turn.status).toBe("done");
      expect(turn.usage).toMatchObject({ inputTokens: 30, outputTokens: 5 });
    });

    it("has the finished steps on disk before the turn ends", async () => {
      const store = new MemorySessionStore();
      const session = newSession(
        new FakeModelClient([{ toolCalls: [{ name: "slow", args: {} }] }]),
        undefined,
        store,
      );
      const controller = new AbortController();
      let duringTool: unknown[] = [];
      for await (const event of session.send("wait", controller.signal)) {
        if (event.type === "tool_call_start") {
          duringTool = [...store.sessions.get("s1")!.turns.get(1)!.items];
          setTimeout(() => controller.abort(), 5);
        }
      }
      expect(duringTool).toEqual([
        { role: "user", content: "wait" },
        expect.objectContaining({ type: "function_call", name: "slow" }),
      ]);
      const turn = store.sessions.get("s1")!.turns.get(1)!;
      expect(turn.status).toBe("cancelled");
      expect(turn.items).toEqual(session.history);
    });

    it("marks a failed turn and keeps history unchanged", async () => {
      const store = new MemorySessionStore();
      const session = newSession(new FakeModelClient([{ error: "boom" }]), undefined, store);
      await collect(session.send("hi"));
      expect(session.history).toHaveLength(0);
      expect(store.sessions.get("s1")!.turns.get(1)!.status).toBe("failed");
    });

    it("numbers turns and keeps the first message as the title", async () => {
      const store = new MemorySessionStore();
      const session = newSession(
        new FakeModelClient([{ text: "one" }, { text: "two" }]),
        undefined,
        store,
      );
      await collect(session.send("first"));
      await collect(session.send("second"));
      const saved = store.sessions.get("s1")!;
      expect([...saved.turns.keys()]).toEqual([1, 2]);
      expect(saved.info.title).toBe("first");
    });

    it("keeps working when saving fails, and says so once", async () => {
      const broken: SessionStore = {
        saveItems: () => {
          throw new Error("disk full");
        },
        saveToolView: () => {},
        endTurn: () => {},
        saveFileChange: () => {},
      };
      const session = newSession(
        new FakeModelClient([{ text: "one" }, { text: "two" }]),
        undefined,
        broken,
      );
      const first = await collect(session.send("a"));
      const second = await collect(session.send("b"));
      expect(first.at(-1)?.type).toBe("turn_complete");
      expect(first).toContainEqual({
        type: "warning",
        message: "This session is no longer being saved: disk full",
      });
      expect(second.some((event) => event.type === "warning")).toBe(false);
      expect(session.history).toHaveLength(4);
    });
  });
});
