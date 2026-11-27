import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { FakeModelClient, type FakeTurn } from "../model/fake.js";
import type { HistoryItem } from "../model/types.js";
import { buildSystemPrompt } from "../prompt/system.js";
import { editTool } from "../tools/edit.js";
import { readFileTool } from "../tools/read-file.js";
import { todosTool } from "../tools/todos.js";
import { defineTool } from "../tools/types.js";
import { isCodePath, REPEAT_NOTE, SAME_ERROR_NOTE, VERIFY_REMINDER } from "./checks.js";
import type { AgentEvent } from "./events.js";
import { Session } from "./session.js";

async function drain(events: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const all: AgentEvent[] = [];
  for await (const event of events) all.push(event);
  return all;
}

const fakeBash = defineTool({
  name: "bash",
  description: "Runs a command.",
  schema: z.strictObject({ command: z.string() }),
  async run({ command }) {
    return { output: `ran ${command}` };
  },
});

const stuck = defineTool({
  name: "check",
  description: "Always says the same.",
  schema: z.strictObject({}),
  async run() {
    return { output: "still not ready" };
  },
});

const failing = defineTool({
  name: "fail",
  description: "Always fails the same way.",
  schema: z.strictObject({ n: z.number() }),
  async run() {
    throw new Error("old_string was not found in a.js");
  },
});

async function setup(turns: FakeTurn[]) {
  const cwd = await mkdtemp(join(tmpdir(), "nimbus-checks-"));
  await writeFile(join(cwd, "a.js"), "let x = 1;\n");
  await writeFile(join(cwd, "notes.md"), "draft\n");
  const client = new FakeModelClient(turns);
  const session = new Session({
    client,
    model: "gpt-6-luna",
    instructions: "x",
    cwd,
    tools: [readFileTool, editTool, todosTool, fakeBash, stuck, failing],
  });
  return { client, session };
}

const read = (path: string) => ({ name: "read_file", args: { path, offset: null, limit: null } });
const edit = (path: string, from: string, to: string) => ({
  name: "edit",
  args: { path, old_string: from, new_string: to, replace_all: null },
});
const outputs = (input: HistoryItem[]) =>
  input
    .filter((item) => (item as { type?: string }).type === "function_call_output")
    .map((item) => (item as { output: string }).output);

describe("todo list", () => {
  it("keeps the latest list and brings it back on resume", async () => {
    const todos = [
      { text: "Add subtract", status: "done" },
      { text: "Write a test", status: "in_progress" },
      { text: "Run the tests", status: "pending" },
    ];
    const { client, session } = await setup([
      { toolCalls: [{ name: "update_todos", args: { todos } }] },
      { text: "working on it" },
    ]);
    const events = await drain(session.send("do three things"));
    expect(session.todos).toEqual(todos);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "tool_call_end",
        summary: "1 of 3 done",
        preview: "☑ Add subtract\n◐ Write a test\n☐ Run the tests",
      }),
    );
    expect(outputs(client.requests[1]!.input)[0]).toBe(
      "Todo list saved (1 done, 1 in progress, 1 pending).",
    );

    const resumed = new Session({
      client: new FakeModelClient([]),
      model: "gpt-6-luna",
      instructions: "x",
      cwd: tmpdir(),
      resume: {
        history: [...session.history],
        turns: 1,
        title: "t",
        usage: session.usage,
        cost: 0,
      },
    });
    expect(resumed.todos).toEqual(todos);
  });
});

describe("checking its own work", () => {
  it("reminds the model once when code changed and nothing ran after", async () => {
    const { client, session } = await setup([
      { toolCalls: [read("a.js")] },
      { toolCalls: [edit("a.js", "1", "2")] },
      { text: "Done." },
      { toolCalls: [{ name: "bash", args: { command: "node --test" } }] },
      { text: "Tests pass." },
    ]);
    const events = await drain(session.send("change x"));
    expect(client.requests[3]!.input.at(-1)).toEqual({ role: "user", content: VERIFY_REMINDER });
    expect(events).toContainEqual({
      type: "notice",
      message: "Asked the model to check its changes before finishing.",
    });
    expect(client.requests).toHaveLength(5);
    expect(events.at(-1)?.type).toBe("turn_complete");
  });

  it("does not remind after a command ran, or for non-code files", async () => {
    const ran = await setup([
      { toolCalls: [read("a.js")] },
      { toolCalls: [edit("a.js", "1", "2")] },
      { toolCalls: [{ name: "bash", args: { command: "node a.js" } }] },
      { text: "Done." },
    ]);
    await drain(ran.session.send("change x"));
    expect(ran.client.requests).toHaveLength(4);

    const docs = await setup([
      { toolCalls: [read("notes.md")] },
      { toolCalls: [edit("notes.md", "draft", "final")] },
      { text: "Done." },
    ]);
    await drain(docs.session.send("edit notes"));
    expect(docs.client.requests).toHaveLength(3);
  });

  it("never overrides a user who said not to run anything", () => {
    expect(VERIFY_REMINDER).toContain(
      "If the user asked you not to run anything, do not run anything: just finish.",
    );
  });

  it("knows which files are code", () => {
    expect(isCodePath("src/a.ts")).toBe(true);
    expect(isCodePath("app.py")).toBe(true);
    expect(isCodePath("README.md")).toBe(false);
    expect(isCodePath("page.html")).toBe(false);
  });
});

describe("loop breaking", () => {
  it("warns on the third identical call and stops on the fifth", async () => {
    const same = { name: "check", args: {} };
    const { client, session } = await setup([
      { toolCalls: [same] },
      { toolCalls: [same] },
      { toolCalls: [same] },
      { toolCalls: [same] },
      { toolCalls: [same] },
      { text: "never" },
    ]);
    const events = await drain(session.send("wait for it"));
    const sent = outputs(client.requests[3]!.input);
    expect(sent[0]).toBe("still not ready");
    expect(sent[2]).toBe(`still not ready\n\n${REPEAT_NOTE}`);
    expect(events.at(-1)).toEqual({ type: "loop_stopped" });
    expect(client.requests).toHaveLength(5);
    expect(session.canRetry).toBe(false);
  });

  it("warns when the same error comes back three times in a row", async () => {
    const { client, session } = await setup([
      { toolCalls: [{ name: "fail", args: { n: 1 } }] },
      { toolCalls: [{ name: "fail", args: { n: 2 } }] },
      { toolCalls: [{ name: "fail", args: { n: 3 } }] },
      { text: "I will ask" },
    ]);
    await drain(session.send("fix it"));
    const sent = outputs(client.requests[3]!.input);
    expect(sent[1]).not.toContain(SAME_ERROR_NOTE);
    expect(sent[2]).toContain(SAME_ERROR_NOTE);
  });
});

describe("system prompt", () => {
  it("asks for a plan and a check before finishing", () => {
    const env = { os: "Linux", shell: "bash", cwd: "/p", date: "2026-11-28" };
    const prompt = buildSystemPrompt(env, ["read_file", "edit", "update_todos", "bash"]);
    expect(prompt).toContain("plan them with update_todos first");
    expect(prompt).toContain("Before you say a task is done, check it");
    expect(buildSystemPrompt(env, ["read_file"])).not.toContain("update_todos");
  });
});
