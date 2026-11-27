import { describe, expect, it } from "vitest";
import { z } from "zod";
import { FakeModelClient, type FakeTurn } from "../model/fake.js";
import { defineTool } from "../tools/types.js";
import type { AgentEvent } from "./events.js";
import { CONNECTION_FAILED, Session } from "./session.js";

async function collect(events: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const all: AgentEvent[] = [];
  for await (const event of events) all.push(event);
  return all;
}

let runs = 0;
const countTool = defineTool({
  name: "count",
  description: "Counts how often it ran.",
  schema: z.strictObject({}),
  async run() {
    runs++;
    return { output: `ran ${runs}` };
  },
});

function newSession(turns: FakeTurn[], delayMs = 0) {
  const client = new FakeModelClient(turns);
  const session = new Session({
    client,
    model: "gpt-6-luna",
    instructions: "test prompt",
    cwd: process.cwd(),
    tools: [countTool],
    id: "s1",
    retryDelay: () => delayMs,
  });
  return { client, session };
}

const busy: FakeTurn = { error: "The model service is busy.", status: 503 };
const dropped: FakeTurn = { error: "socket hang up", code: "ECONNRESET" };
const retries = (events: AgentEvent[]) => events.filter((event) => event.type === "retrying");

describe("Session retries", () => {
  it("retries a server error and then finishes the reply", async () => {
    const { client, session } = newSession([busy, { text: "Hello" }]);
    const events = await collect(session.send("hi"));
    expect(retries(events)).toEqual([
      {
        type: "retrying",
        attempt: 1,
        maxRetries: 5,
        delayMs: 0,
        reason: "Server error",
        restarted: false,
      },
    ]);
    expect(events.at(-1)?.type).toBe("turn_complete");
    expect(client.requests).toHaveLength(2);
    expect(client.requests[1]!.input).toEqual(client.requests[0]!.input);
  });

  it("restarts a reply that dropped mid-stream and keeps only the full one", async () => {
    const { session } = newSession([{ ...dropped, partialText: "Hel" }, { text: "Hello" }]);
    const events = await collect(session.send("hi"));
    expect(retries(events)[0]).toMatchObject({ reason: "Connection lost", restarted: true });
    expect(session.history).toEqual([
      { role: "user", content: "hi" },
      { role: "assistant", content: "Hello" },
    ]);
  });

  it("gives up after five retries and keeps the turn for retry()", async () => {
    const { client, session } = newSession([busy, busy, busy, busy, busy, busy]);
    const events = await collect(session.send("hi"));
    expect(retries(events).map((event) => event.type === "retrying" && event.attempt)).toEqual([
      1, 2, 3, 4, 5,
    ]);
    expect(events.at(-1)).toMatchObject({ type: "error", status: 503 });
    expect(client.requests).toHaveLength(6);
    expect(session.canRetry).toBe(true);
  });

  it("says plainly when the server could not be reached at all", async () => {
    const { session } = newSession([dropped, dropped, dropped, dropped, dropped, dropped]);
    const events = await collect(session.send("hi"));
    expect(events.at(-1)).toEqual({
      type: "error",
      message: CONNECTION_FAILED,
      code: "ECONNRESET",
    });
  });

  it("does not retry errors that another try cannot fix", async () => {
    for (const turn of [
      { error: "Bad request", status: 400 },
      { error: "Invalid token", status: 401 },
      { error: "Credit used up", status: 402 },
      { error: "No credit", status: 429, code: "insufficient_quota" },
      { error: "boom" },
    ]) {
      const { client, session } = newSession([turn]);
      const events = await collect(session.send("hi"));
      expect(retries(events)).toEqual([]);
      expect(client.requests).toHaveLength(1);
    }
  });

  it("stops waiting when the user presses esc", async () => {
    const { client, session } = newSession([busy, { text: "never" }], 60_000);
    const controller = new AbortController();
    const events: AgentEvent[] = [];
    for await (const event of session.send("hi", controller.signal)) {
      events.push(event);
      if (event.type === "retrying") controller.abort();
    }
    expect(events.at(-1)).toEqual({ type: "turn_cancelled" });
    expect(client.requests).toHaveLength(1);
  });

  it("never runs a tool again when the next model call is retried", async () => {
    runs = 0;
    const { session } = newSession([
      { toolCalls: [{ name: "count", args: {} }] },
      busy,
      dropped,
      { text: "Done" },
    ]);
    const events = await collect(session.send("count once"));
    expect(runs).toBe(1);
    expect(retries(events)).toHaveLength(2);
    expect(events.at(-1)?.type).toBe("turn_complete");
  });
});
