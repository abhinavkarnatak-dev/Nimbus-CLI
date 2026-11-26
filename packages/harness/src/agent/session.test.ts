import { describe, expect, it } from "vitest";
import { z } from "zod";
import { FakeModelClient } from "../model/fake.js";
import { defineTool } from "../tools/types.js";
import type { AgentEvent } from "./events.js";
import { Session } from "./session.js";

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

function newSession(client: FakeModelClient, maxSteps?: number): Session {
  return new Session({
    client,
    model: "gpt-6-luna",
    instructions: "test prompt",
    cwd: process.cwd(),
    tools: [echoTool, slowTool],
    maxSteps,
    id: "s1",
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

  it("stops on abort and keeps history unchanged", async () => {
    const session = newSession(new FakeModelClient([{ text: "one two three four five" }]));
    const controller = new AbortController();
    const events: AgentEvent[] = [];

    for await (const event of session.send("hi", controller.signal)) {
      events.push(event);
      if (event.type === "text_delta") controller.abort();
    }

    expect(events.at(-1)).toEqual({ type: "turn_cancelled" });
    expect(textOf(events)).toBe("one ");
    expect(session.history).toHaveLength(0);
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

    it("cancels a running tool and leaves history empty", async () => {
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
      expect(session.history).toHaveLength(0);
    });
  });
});
