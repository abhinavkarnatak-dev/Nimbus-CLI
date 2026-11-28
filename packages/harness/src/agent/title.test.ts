import { describe, expect, it } from "vitest";
import { FakeModelClient } from "../model/fake.js";
import type { AgentEvent } from "./events.js";
import { Session } from "./session.js";
import { MemorySessionStore } from "./store.js";
import { parseTitle, titleRequest } from "./title.js";

async function drain(events: AsyncIterable<AgentEvent>): Promise<void> {
  for await (const _event of events) void _event;
}

const describeMessage = (text: string) => (text === "LONG HIDDEN INIT" ? "/init" : text);

function newSession(client: FakeModelClient, store = new MemorySessionStore()) {
  return new Session({
    client,
    model: "gpt-6.2-astra",
    instructions: "t",
    cwd: process.cwd(),
    id: "s1",
    store,
    describeMessage,
    titles: true,
  });
}

describe("session titles", () => {
  it("cleans the model's answer and treats NONE as no title", () => {
    expect(parseTitle('"Fix login redirect bug."')).toBe("Fix login redirect bug");
    expect(parseTitle("NONE")).toBeNull();
    expect(parseTitle("  none \n")).toBeNull();
    expect(parseTitle("")).toBeNull();
    const request = titleRequest(["hi", "x".repeat(400)]);
    expect(request).toContain("1. hi\n2. ");
    expect(request).toContain(`${"x".repeat(300)}...`);
  });

  it("starts with what the user typed, and waits for a meaningful message", async () => {
    const store = new MemorySessionStore();
    const client = new FakeModelClient([
      { text: "Hello!" },
      { text: "NONE" },
      { text: "Done" },
      { text: "Write AGENTS.md for the project" },
    ]);
    const session = newSession(client, store);
    await drain(session.send("LONG HIDDEN INIT"));
    expect(session.title).toBe("/init");
    expect(await session.makeTitle()).toBeNull();
    expect(client.requests[1]!.model).toBe("gpt-6-luna");
    expect(client.requests[1]!.effort).toBe("none");
    expect(client.requests[1]!.input[0]).toEqual({
      role: "user",
      content: titleRequest(["/init"]),
    });

    await drain(session.send("now add the test commands"));
    expect(await session.makeTitle()).toBe("Write AGENTS.md for the project");
    expect(session.title).toBe("Write AGENTS.md for the project");
    expect(store.titles.get("s1")).toEqual({
      title: "Write AGENTS.md for the project",
      source: "model",
    });
    // Named once, never asked again
    expect(await session.makeTitle()).toBeNull();
    expect(client.requests).toHaveLength(4);
    expect(session.trace()!.calls.map((call) => call.kind)).toEqual(["reply", "title"]);
  });

  it("keeps the user's own name and survives a failed title call", async () => {
    const store = new MemorySessionStore();
    const session = newSession(new FakeModelClient([{ text: "ok" }, { error: "down" }]), store);
    await drain(session.send("fix the build"));
    expect(await session.makeTitle()).toBeNull();
    session.rename("My build fixes");
    expect(store.titles.get("s1")).toEqual({ title: "My build fixes", source: "user" });
    expect(await session.makeTitle()).toBeNull();
    expect(session.title).toBe("My build fixes");
  });

  it("uses the resumed messages for the title, skipping Nimbus's own notes", async () => {
    const client = new FakeModelClient([{ text: "Debug flaky tests" }]);
    const session = new Session({
      client,
      model: "gpt-6-luna",
      instructions: "t",
      cwd: process.cwd(),
      describeMessage,
      titles: true,
      resume: {
        history: [
          { role: "user", content: "hi" },
          { role: "assistant", content: "Hello" },
          { role: "user", content: "[Nimbus closed before this reply finished.]" },
          { role: "user", content: "why are my tests flaky?" },
        ],
        turns: 2,
        title: "hi",
        usage: { inputTokens: 0, cachedTokens: 0, cacheWriteTokens: 0, outputTokens: 0 },
        cost: 0,
      },
    });
    expect(await session.makeTitle()).toBe("Debug flaky tests");
    expect(client.requests[0]!.input[0]).toEqual({
      role: "user",
      content: titleRequest(["hi", "why are my tests flaky?"]),
    });
  });
});
