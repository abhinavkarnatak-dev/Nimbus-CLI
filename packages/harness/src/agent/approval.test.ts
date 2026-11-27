import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FakeModelClient, type FakeTurn } from "../model/fake.js";
import type { HistoryItem } from "../model/types.js";
import { buildSystemPrompt } from "../prompt/system.js";
import { editTool } from "../tools/edit.js";
import { FileTracker } from "../tools/file-state.js";
import { grepTool } from "../tools/grep.js";
import { readFileTool } from "../tools/read-file.js";
import { alwaysAskReason, isSecretPath, mentionsSecret } from "../tools/secrets.js";
import { writeFileTool } from "../tools/write-file.js";
import { DECLINED_NOTE, SKIPPED_NOTE, type ApprovalRequest } from "./approval.js";
import type { AgentEvent } from "./events.js";
import { Session } from "./session.js";

async function drain(events: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const all: AgentEvent[] = [];
  for await (const event of events) all.push(event);
  return all;
}

async function project() {
  const cwd = await mkdtemp(join(tmpdir(), "nimbus-safe-"));
  await writeFile(join(cwd, "a.txt"), "one\n");
  await writeFile(join(cwd, ".env"), "API_KEY=sk-secret\n");
  await writeFile(join(cwd, ".env.example"), "API_KEY=\n");
  return cwd;
}

const read = (path: string) => ({ name: "read_file", args: { path, offset: null, limit: null } });
const edit = (path: string) => ({
  name: "edit",
  args: { path, old_string: "one", new_string: "two", replace_all: null },
});
const outputs = (input: HistoryItem[]) =>
  input
    .filter((item) => (item as { type?: string }).type === "function_call_output")
    .map((item) => (item as { output: string }).output);

async function session(turns: FakeTurn[], answer: "allow" | "deny" | "wait") {
  const cwd = await project();
  const asked: ApprovalRequest[] = [];
  const client = new FakeModelClient(turns);
  const s = new Session({
    client,
    model: "gpt-6-luna",
    instructions: "x",
    cwd,
    tools: [readFileTool, editTool, writeFileTool],
    approve: async (request, signal) => {
      asked.push(request);
      if (answer !== "wait") return answer;
      return new Promise((_resolve, reject) =>
        signal.addEventListener("abort", () => reject(signal.reason), { once: true }),
      );
    },
  });
  return { cwd, asked, client, session: s };
}

describe("asking before actions", () => {
  it("asks before edits but never before reads, and runs when allowed", async () => {
    const {
      cwd,
      asked,
      session: s,
    } = await session(
      [{ toolCalls: [read("a.txt")] }, { toolCalls: [edit("a.txt")] }, { text: "done" }],
      "allow",
    );
    await drain(s.send("change a"));
    expect(asked.map((request) => request.tool)).toEqual(["edit"]);
    expect(asked[0]!.args).toMatchObject({ path: "a.txt", new_string: "two" });
    expect(await readFile(join(cwd, "a.txt"), "utf8")).toBe("two\n");
  });

  it("stops the reply on a no, skips the rest of the step and tells the model", async () => {
    const {
      cwd,
      client,
      session: s,
    } = await session(
      [
        { toolCalls: [read("a.txt")] },
        { toolCalls: [edit("a.txt"), read("a.txt")] },
        { text: "never" },
        { text: "Okay, what instead?" },
      ],
      "deny",
    );
    const events = await drain(s.send("change a"));
    expect(events.at(-1)).toEqual({ type: "declined" });
    expect(events).toContainEqual(
      expect.objectContaining({ type: "tool_call_end", summary: "Declined by you", isError: true }),
    );
    expect(await readFile(join(cwd, "a.txt"), "utf8")).toBe("one\n");
    expect(client.requests).toHaveLength(2);

    await drain(s.send("leave it"));
    const sent = outputs(client.requests[2]!.input);
    expect(sent.slice(-2)).toEqual([DECLINED_NOTE, SKIPPED_NOTE]);
  });

  it("treats esc while asking as a stop", async () => {
    const { session: s } = await session(
      [{ toolCalls: [read("a.txt")] }, { toolCalls: [edit("a.txt")] }],
      "wait",
    );
    const controller = new AbortController();
    const events: AgentEvent[] = [];
    for await (const event of s.send("change a", controller.signal)) {
      events.push(event);
      if (event.type === "tool_call_start" && event.name === "edit")
        setTimeout(() => controller.abort(), 5);
    }
    expect(events.at(-1)).toEqual({ type: "turn_cancelled" });
  });
});

describe("secret files", () => {
  it("knows which files are secret", () => {
    for (const path of [
      ".env",
      ".env.local",
      "config/.env.production",
      "id_rsa",
      "server.pem",
      "my.key",
      ".npmrc",
      "credentials.json",
      "client_secret_123.json",
    ]) {
      expect(isSecretPath(path)).toBe(true);
    }
    for (const path of [
      ".env.example",
      ".env.sample",
      "id_rsa.pub",
      "keyboard.ts",
      "README.md",
      "env.ts",
    ]) {
      expect(isSecretPath(path)).toBe(false);
    }
  });

  it("refuses to read, search or change them, but reads example files", async () => {
    const cwd = await project();
    const ctx = { cwd, signal: new AbortController().signal, files: new FileTracker() };
    const refused = await readFileTool.execute(
      JSON.stringify({ path: ".env", offset: null, limit: null }),
      ctx,
    );
    expect(refused.isError).toBe(true);
    expect(refused.output).toContain(".env looks like a secret file");
    expect(refused.output).toContain("ask the user for that value");

    const example = await readFileTool.execute(
      JSON.stringify({ path: ".env.example", offset: null, limit: null }),
      ctx,
    );
    expect(example.output).toContain("API_KEY=");

    const search = await grepTool.execute(
      JSON.stringify({
        pattern: "API_KEY",
        path: null,
        glob: null,
        case_insensitive: null,
        output_mode: "files",
      }),
      ctx,
    );
    expect(search.output).toContain(".env.example");
    expect(search.output).not.toMatch(/^\.env$/m);

    const write = await writeFileTool.execute(
      JSON.stringify({ path: ".env.local", content: "X=1" }),
      ctx,
    );
    expect(write.output).toContain("looks like a secret file");
  });

  it("flags commands that must always ask", () => {
    expect(mentionsSecret("cat .env")).toBe(true);
    expect(mentionsSecret("type config\\.env.local")).toBe(true);
    expect(mentionsSecret("npm test")).toBe(false);
    expect(alwaysAskReason("cat .env")).toBe("This command touches a secret file.");
    expect(alwaysAskReason("git push origin main")).toBe(
      "This command pushes to a remote git repository.",
    );
    expect(alwaysAskReason("git commit -m x")).toBe("This command creates a git commit.");
    expect(alwaysAskReason("git pull")).toBe("This command changes git history.");
    expect(alwaysAskReason("npm publish")).toBe("This command publishes a package.");
    expect(alwaysAskReason("git status")).toBeNull();
  });
});

describe("safety prompt", () => {
  it("adds the safety rules when Nimbus can change things", () => {
    const env = { os: "Linux", shell: "bash", cwd: "/p", date: "2026-11-28" };
    expect(buildSystemPrompt(env, ["read_file", "bash"])).toContain(
      "Never read secret files such as .env",
    );
    expect(buildSystemPrompt(env, ["read_file"])).not.toContain("Safety:");
  });
});
