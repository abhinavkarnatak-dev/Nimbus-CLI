import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { describe, expect, it } from "vitest";
import { FakeModelClient } from "../model/fake.js";
import { globTool } from "../tools/glob.js";
import { grepTool } from "../tools/grep.js";
import { readFileTool } from "../tools/read-file.js";
import type { ApprovalRequest } from "./approval.js";
import type { AgentEvent } from "./events.js";
import { Session } from "./session.js";

async function events(stream: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const all: AgentEvent[] = [];
  for await (const event of stream) all.push(event);
  return all;
}

async function setup() {
  const cwd = await mkdtemp(join(tmpdir(), "nimbus-here-"));
  const other = await mkdtemp(join(tmpdir(), "nimbus-other-"));
  await mkdir(join(other, "notes"));
  await writeFile(join(other, "notes", "plan.md"), "step one\nPAPAYA step\n");
  await writeFile(join(other, ".env"), "API_KEY=sk-secret\n");
  return { cwd, other };
}

const read = (path: string) => ({ name: "read_file", args: { path, offset: null, limit: null } });
const ends = (all: AgentEvent[]) =>
  all.filter((event) => event.type === "tool_call_end") as Extract<
    AgentEvent,
    { type: "tool_call_end" }
  >[];

describe("reading outside the working folder", () => {
  it("asks once per call with the folder, and reads after a yes", async () => {
    const { cwd, other } = await setup();
    const file = join(other, "notes", "plan.md");
    const asked: ApprovalRequest[] = [];
    const client = new FakeModelClient([{ toolCalls: [read(file)] }, { text: "done" }]);
    const session = new Session({
      client,
      model: "gpt-6-luna",
      instructions: "t",
      cwd,
      tools: [readFileTool],
      approve: async (request) => {
        asked.push(request);
        return "allow";
      },
    });
    const all = await events(session.send("read it"));
    expect(asked).toHaveLength(1);
    expect(asked[0]!.folder).toContain("notes");
    expect(ends(all)[0]!.isError).toBe(false);
    const output = session.history.find(
      (item) => (item as { type?: string }).type === "function_call_output",
    ) as { output: string };
    expect(output.output).toContain("PAPAYA step");
  });

  it("does not ask inside the working folder, and stops on a no", async () => {
    const { cwd, other } = await setup();
    await writeFile(join(cwd, "here.txt"), "local\n");
    const asked: ApprovalRequest[] = [];
    const client = new FakeModelClient([
      { toolCalls: [read("here.txt")] },
      { toolCalls: [read(join(other, "notes", "plan.md"))] },
      { text: "never" },
    ]);
    const session = new Session({
      client,
      model: "gpt-6-luna",
      instructions: "t",
      cwd,
      tools: [readFileTool],
      approve: async (request) => {
        asked.push(request);
        return "deny";
      },
    });
    const all = await events(session.send("read both"));
    expect(asked).toHaveLength(1);
    expect(all.some((event) => event.type === "declined")).toBe(true);
  });

  it("still refuses secret files outside, and refuses everything with no one to ask", async () => {
    const { cwd, other } = await setup();
    const base = {
      cwd,
      signal: new AbortController().signal,
      files: new (await import("../tools/file-state.js")).FileTracker(),
    };
    const secret = await readFileTool.execute(
      JSON.stringify({ path: join(other, ".env"), offset: null, limit: null }),
      { ...base, approvedDir: other },
    );
    expect(secret.isError).toBe(true);
    const plain = await readFileTool.execute(
      JSON.stringify({ path: join(other, "notes", "plan.md"), offset: null, limit: null }),
      base,
    );
    expect(plain.output).toContain("outside the working directory");
  });

  it("searches and lists an allowed outside folder with full paths", async () => {
    const { cwd, other } = await setup();
    const base = {
      cwd,
      signal: new AbortController().signal,
      files: new (await import("../tools/file-state.js")).FileTracker(),
      approvedDir: other,
    };
    expect(
      await globTool.askFirst!(JSON.stringify({ pattern: "*.md", path: other }), {
        ...base,
        approvedDir: undefined,
      }),
    ).toBeTruthy();
    const listed = await globTool.execute(
      JSON.stringify({ pattern: "**/*.md", path: other }),
      base,
    );
    expect(listed.output).toMatch(new RegExp(`(^|/)${basename(other)}/notes/plan.md`));
    const found = await grepTool.execute(
      JSON.stringify({
        pattern: "PAPAYA",
        path: other,
        glob: null,
        case_insensitive: null,
        output_mode: "content",
      }),
      base,
    );
    expect(found.output).toContain("notes/plan.md:2:PAPAYA step");
    expect(found.output).toContain(`${basename(other)}/notes/plan.md`);
    expect(found.output).not.toContain(".env");
  });
});
