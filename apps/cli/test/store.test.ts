import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FakeModelClient, Session, STOPPED_NOTE, type Tool } from "@nimbus/harness";
import { describe, expect, it } from "vitest";
import { openSessionStore } from "../src/store/sqlite.js";

const echo: Tool = {
  name: "echo",
  description: "Echo text back.",
  parameters: { type: "object", properties: {}, additionalProperties: true },
  async execute(rawArgs) {
    const { text } = JSON.parse(rawArgs) as { text: string };
    return { output: `echo: ${text}`, summary: "echoed", diff: "+ hi" };
  },
};

async function drain(events: AsyncIterable<unknown>): Promise<unknown[]> {
  const seen: unknown[] = [];
  for await (const event of events) seen.push(event);
  return seen;
}

async function dbPath(): Promise<string> {
  return join(await mkdtemp(join(tmpdir(), "nimbus-store-")), "nested", "nimbus.db");
}

describe("SQLite session store", () => {
  it("saves a session and loads it back after reopening the file", async () => {
    const path = await dbPath();
    const store = openSessionStore(path);
    const session = new Session({
      client: new FakeModelClient([
        { toolCalls: [{ name: "echo", args: { text: "hi" } }], usage: { inputTokens: 100 } },
        { text: "Done", usage: { inputTokens: 50, cachedTokens: 40, outputTokens: 7 } },
      ]),
      model: "gpt-6-luna",
      instructions: "test",
      cwd: "/projects/demo",
      tools: [echo],
      id: "abc",
      store,
    });
    await drain(session.send("say hi please"));
    store.close();

    const reopened = openSessionStore(path);
    const saved = reopened.load("abc")!;
    expect(saved.info).toEqual({
      id: "abc",
      cwd: "/projects/demo",
      model: "gpt-6-luna",
      title: "say hi please",
    });
    expect(saved.turns).toHaveLength(1);
    expect(saved.turns[0]!.status).toBe("done");
    expect(saved.turns[0]!.items).toEqual(session.history);
    expect(saved.turns[0]!.views).toEqual([
      expect.objectContaining({ callId: "call_1", summary: "echoed", diff: "+ hi" }),
    ]);
    expect(saved.turns[0]!.usage).toEqual({
      inputTokens: 150,
      cachedTokens: 40,
      outputTokens: 7,
    });
    expect(reopened.load("missing")).toBeNull();
    reopened.close();
  });

  it("keeps a stopped turn with its note", async () => {
    const store = openSessionStore(await dbPath());
    const session = new Session({
      client: new FakeModelClient([{ text: "one two three" }]),
      model: "gpt-6-luna",
      instructions: "test",
      cwd: "/projects/demo",
      id: "stop",
      store,
    });
    const controller = new AbortController();
    for await (const event of session.send("go", controller.signal)) {
      if (event.type === "text_delta") controller.abort();
    }
    const turn = store.load("stop")!.turns[0]!;
    expect(turn.status).toBe("cancelled");
    expect(turn.items.at(-1)).toEqual({ role: "user", content: STOPPED_NOTE });
    store.close();
  });

  it("keeps file copies for undo, with the latest version of each file", async () => {
    const path = await dbPath();
    const store = openSessionStore(path);
    const info = { id: "s1", cwd: "/p", model: "gpt-6-luna", title: "edit" };
    store.saveItems(info, 1, [{ role: "user", content: "edit" }]);
    const change = {
      turn: 1,
      turnTitle: "edit",
      path: "/p/a.txt",
      display: "a.txt",
      before: Buffer.from("old"),
      after: Buffer.from("mid"),
      tooBig: false,
    };
    store.saveFileChange("s1", change);
    store.saveFileChange("s1", {
      ...change,
      before: Buffer.from("ignored"),
      after: Buffer.from("new"),
    });
    store.saveFileChange("s1", { ...change, path: "/p/b.txt", display: "b.txt", before: null });
    store.close();

    const [a, b] = openSessionStore(path).load("s1")!.fileChanges;
    expect(a).toMatchObject({ display: "a.txt", turnTitle: "edit", tooBig: false });
    expect(a!.before!.toString()).toBe("old");
    expect(a!.after!.toString()).toBe("new");
    expect(b!.before).toBeNull();
  });

  it("opens an existing file without running the schema twice", async () => {
    const path = await dbPath();
    openSessionStore(path).close();
    const again = openSessionStore(path);
    expect(again.load("nothing")).toBeNull();
    again.close();
  });
});
