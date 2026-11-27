import { describe, expect, it } from "vitest";
import { z } from "zod";
import { CONTEXT_LIMIT } from "../cost.js";
import { FakeModelClient, type FakeTurn } from "../model/fake.js";
import type { ModelRequest } from "../model/types.js";
import { defineTool } from "../tools/types.js";
import { contextParts, type ContextParts } from "./context.js";
import type { AgentEvent } from "./events.js";
import { Session } from "./session.js";

async function drain(events: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const all: AgentEvent[] = [];
  for await (const event of events) all.push(event);
  return all;
}

const echo = defineTool({
  name: "echo",
  description: "Echo text back.",
  schema: z.strictObject({ text: z.string() }),
  async run({ text }) {
    return { output: `echo: ${text}` };
  },
});

const slow = defineTool({
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

function newSession(turns: FakeTurn[]) {
  const client = new FakeModelClient(turns);
  const session = new Session({
    client,
    model: "gpt-6-luna",
    instructions: "You are a test agent. ".repeat(40),
    cwd: process.cwd(),
    tools: [echo, slow],
    id: "s1",
  });
  return { client, session };
}

const sum = (parts: ContextParts) =>
  parts.system + parts.tools + parts.conversation + parts.toolCalls + parts.reasoning;

describe("context", () => {
  it("is estimated before the first call", () => {
    const { session } = newSession([]);
    const context = session.context();
    expect(context.estimated).toBe(true);
    expect(context.limit).toBe(CONTEXT_LIMIT);
    expect(context.tokens).toBeGreaterThan(200);
    expect(context.tokens).toBe(sum(context.parts));
  });

  it("is exact after a call: input plus output of the last call", async () => {
    const { session } = newSession([
      { toolCalls: [{ name: "echo", args: { text: "hi" } }], usage: { inputTokens: 3000 } },
      { text: "Done", usage: { inputTokens: 3100, outputTokens: 40 } },
    ]);
    await drain(session.send("say hi"));
    const context = session.context();
    expect(context).toMatchObject({ tokens: 3140, estimated: false });
    expect(sum(context.parts)).toBe(3140);
    expect(context.parts.reasoning).toBeGreaterThanOrEqual(0);
  });

  it("adds an estimate for what came after the last call", async () => {
    const { session } = newSession([
      { text: "Done", usage: { inputTokens: 3000, outputTokens: 40 } },
      { error: "boom" },
    ]);
    await drain(session.send("first"));
    await drain(session.send("x".repeat(400)));
    const context = session.context();
    expect(context.estimated).toBe(true);
    expect(context.tokens).toBe(3040 + 100);
  });

  it("splits the parts and keeps them adding up when the estimate is too high", () => {
    const parts = contextParts(
      "x".repeat(4000),
      [],
      [{ role: "user", content: "y".repeat(4000) }],
      1000,
    );
    expect(sum(parts)).toBe(1000);
    expect(parts.reasoning).toBe(0);
  });
});

// The cache only works if each request starts exactly like the one before
describe("cache-friendly requests", () => {
  const startsWith = (later: ModelRequest, earlier: ModelRequest) => {
    expect(later.instructions).toBe(earlier.instructions);
    expect(later.tools).toEqual(earlier.tools);
    expect(later.promptCacheKey).toBe(earlier.promptCacheKey);
    expect(later.input.slice(0, earlier.input.length)).toEqual(earlier.input);
  };

  it("only ever adds to the request, through tools, stops, errors and new messages", async () => {
    const { client, session } = newSession([
      { toolCalls: [{ name: "echo", args: { text: "a" } }] },
      { text: "first answer" },
      { toolCalls: [{ name: "slow", args: {} }] },
      { error: "boom" },
      { toolCalls: [{ name: "echo", args: { text: "b" } }] },
      { text: "last answer" },
    ]);
    await drain(session.send("one"));

    const controller = new AbortController();
    for await (const event of session.send("two", controller.signal)) {
      if (event.type === "tool_call_start") setTimeout(() => controller.abort(), 5);
    }
    await drain(session.send("three"));
    await drain(session.send("four"));

    expect(client.requests).toHaveLength(6);
    for (let i = 1; i < client.requests.length; i++) {
      startsWith(client.requests[i]!, client.requests[i - 1]!);
    }
  });
});
