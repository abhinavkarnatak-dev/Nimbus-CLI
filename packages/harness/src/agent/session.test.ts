import { describe, expect, it } from "vitest";
import { FakeModelClient } from "../model/fake.js";
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

function newSession(client: FakeModelClient): Session {
  return new Session({ client, model: "gpt-6-luna", instructions: "test prompt", id: "s1" });
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
});
