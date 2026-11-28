import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultTools, FakeModelClient, loadSkills, Session, skillRequest } from "@nimbus/harness";
import { render } from "ink-testing-library";
import { describe, expect, it, vi } from "vitest";
import { SwitchableModelClient } from "../src/auth/client.js";
import { AuthController } from "../src/auth/controller.js";
import { memoryStore } from "../src/auth/credentials.js";
import { memorySecret } from "../src/auth/secrets.js";
import { Permissions } from "../src/permissions.js";
import { FileMemory } from "../src/store/memory.js";
import { COMMANDS, COMMIT_REQUEST, INIT_REQUEST } from "../src/ui/commands.js";
import { ModelChoice } from "../src/model-choice.js";
import { BillingController } from "../src/billing/controller.js";
import { RoutingModelClient } from "../src/billing/router.js";
import { memorySettings } from "../src/settings.js";
import type { SavedSession, SessionHistory } from "../src/store/sqlite.js";
import { App } from "../src/ui/App.js";

const tick = (ms = 80) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(check: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error("Timed out waiting for the UI");
    await tick(20);
  }
}

// Logged in on Nimbus credit, for tests that are not about login or billing
function signedIn() {
  const switchable = new SwitchableModelClient(() => new FakeModelClient([]));
  const auth = new AuthController({
    serverUrl: "http://server.test",
    store: memoryStore({ token: "nmb_t", email: "me@gmail.com" }),
    client: switchable,
    fetchFn: (async () => new Response(null, { status: 500 })) as unknown as typeof fetch,
    login: async () => ({ token: "nmb_t", email: "me@gmail.com" }),
  });
  const billing = new BillingController({
    keys: memorySecret(null),
    settings: memorySettings({}),
    client: new RoutingModelClient(switchable, () => new FakeModelClient([])),
    model: "gpt-6-luna",
  });
  return { auth, billing };
}

describe("App", () => {
  it("runs a turn with a tool call and shows the reply", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "nimbus-app-"));
    await writeFile(join(cwd, "notes.md"), "hello\n");
    const client = new FakeModelClient([
      { toolCalls: [{ name: "read_file", args: { path: "notes.md", offset: null, limit: null } }] },
      { text: "The file says **hello**.", usage: { inputTokens: 1200, outputTokens: 30 } },
    ]);
    const createSession = () =>
      new Session({ client, model: "gpt-6-luna", instructions: "test", cwd, tools: defaultTools });

    const { lastFrame, frames, stdin, unmount } = render(
      <App
        createSession={createSession}
        info={{
          version: "0.0.0",
          model: "gpt-6-luna",
          shell: "bash",
          cwd,
          route: "server",
        }}
        {...signedIn()}
      />,
    );
    const all = () => frames.join("\n");

    await tick();
    expect(lastFrame()).toContain("Welcome to Nimbus");
    stdin.write("what is in notes.md");
    await tick();
    expect(lastFrame()).toContain("what is in notes.md");
    stdin.write("\r");

    await waitFor(() => all().includes("hello") && !lastFrame()!.includes("Working"));
    const output = all();
    expect(output).toContain("Read(notes.md)");
    expect(output).toContain("Read 1 line");
    expect(output).toContain("The file says");
    expect(lastFrame()).toContain("gpt-6-luna");
    expect(lastFrame()).not.toContain("tokens");
    expect(lastFrame()).not.toContain("$");
    unmount();
  });

  it("shows the retry countdown and then the reply", async () => {
    const client = new FakeModelClient([
      { error: "socket hang up", code: "ECONNRESET" },
      { text: "back online" },
    ]);
    const createSession = () =>
      new Session({
        client,
        model: "gpt-6-luna",
        instructions: "test",
        cwd: tmpdir(),
        retryDelay: () => 1500,
      });
    const { lastFrame, frames, stdin, unmount } = render(
      <App
        createSession={createSession}
        info={{ version: "0", model: "gpt-6-luna", shell: "bash", cwd: tmpdir() }}
        {...signedIn()}
      />,
    );
    await tick();
    stdin.write("hello");
    await tick();
    stdin.write("\r");
    await waitFor(() => (lastFrame() ?? "").includes("Connection lost, retrying in 2s"));
    expect(lastFrame()).toContain("attempt 1 of 5");
    await waitFor(() => frames.join("\n").includes("back online"), 5000);
    expect(lastFrame()).not.toContain("retrying");
    unmount();
  });

  it("pauses at the budget and continues the same reply on Enter", async () => {
    const client = new FakeModelClient([
      {
        toolCalls: [{ name: "read_file", args: { path: "a.txt", offset: null, limit: null } }],
        usage: { inputTokens: 100_000, outputTokens: 10_000 },
      },
      { text: "budget answer" },
    ]);
    const cwd = await mkdtemp(join(tmpdir(), "nimbus-budget-"));
    await writeFile(join(cwd, "a.txt"), "hi\n");
    const createSession = () =>
      new Session({ client, model: "gpt-6-luna", instructions: "test", cwd, tools: defaultTools });
    const { lastFrame, frames, stdin, unmount } = render(
      <App
        createSession={createSession}
        info={{ version: "0", model: "gpt-6-luna", shell: "bash", cwd }}
        {...signedIn()}
      />,
    );
    await tick();
    stdin.write("/budget 0.01");
    await tick();
    stdin.write("\r");
    await waitFor(() => frames.join("\n").includes("this session pauses at $0.01"));
    stdin.write("read a.txt");
    await tick();
    stdin.write("\r");
    await waitFor(() => (lastFrame() ?? "").includes("Press Enter to allow $0.01 more"));
    expect(frames.join("\n")).not.toContain("budget answer");
    stdin.write("\r");
    await waitFor(() => frames.join("\n").includes("budget answer"));
    expect(client.requests).toHaveLength(2);
    unmount();
  });

  it("compacts the conversation on /compact", async () => {
    const client = new FakeModelClient([
      { text: `first answer ${"word ".repeat(2000)}` },
      { text: "SUMMARY of it" },
    ]);
    const createSession = () =>
      new Session({ client, model: "gpt-6-luna", instructions: "test", cwd: tmpdir() });
    const { frames, stdin, unmount } = render(
      <App
        createSession={createSession}
        info={{ version: "0", model: "gpt-6-luna", shell: "bash", cwd: tmpdir() }}
        {...signedIn()}
      />,
    );
    await tick();
    stdin.write("hello");
    await tick();
    stdin.write("\r");
    await waitFor(() => frames.join("\n").includes("first answer"));
    stdin.write("/compact keep names");
    await tick();
    stdin.write("\r");
    await waitFor(() => frames.join("\n").includes("Conversation compacted:"));
    expect(frames.join("\n")).not.toContain("SUMMARY of it");
    unmount();
  });

  it("shows the checklist live while the model works, and /todo after", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    const waitTool = {
      name: "wait",
      description: "Waits.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      async execute() {
        await gate;
        return { output: "ok" };
      },
    };
    const todos = [
      { text: "Add subtract", status: "done" },
      { text: "Write a test", status: "in_progress" },
      { text: "Run the tests", status: "pending" },
    ];
    const client = new FakeModelClient([
      {
        toolCalls: [
          { name: "update_todos", args: { todos } },
          { name: "wait", args: {} },
        ],
      },
      { text: "all set" },
    ]);
    const createSession = () =>
      new Session({
        client,
        model: "gpt-6-luna",
        instructions: "test",
        cwd: tmpdir(),
        tools: [...defaultTools, waitTool],
      });
    const { lastFrame, frames, stdin, unmount } = render(
      <App
        createSession={createSession}
        info={{ version: "0", model: "gpt-6-luna", shell: "bash", cwd: tmpdir() }}
        {...signedIn()}
      />,
    );
    await tick();
    stdin.write("do three things");
    await tick();
    stdin.write("\r");
    await waitFor(() => (lastFrame() ?? "").includes("◐ Write a test"));
    expect(lastFrame()).toContain("☐ Run the tests");
    release();
    await waitFor(() => frames.join("\n").includes("all set"));
    stdin.write("/todo");
    await tick();
    stdin.write("\r");
    await waitFor(() => (lastFrame() ?? "").includes("☑ Add subtract"));
    unmount();
  });

  it("asks before an edit, runs it on yes, and stops on esc", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "nimbus-approve-"));
    await writeFile(join(cwd, "a.txt"), "one\n");
    const read = { name: "read_file", args: { path: "a.txt", offset: null, limit: null } };
    const change = (to: string) => ({
      name: "edit",
      args: { path: "a.txt", old_string: "one", new_string: to, replace_all: null },
    });
    const client = new FakeModelClient([
      { toolCalls: [read] },
      { toolCalls: [change("two")] },
      { text: "changed it" },
      { toolCalls: [read] },
      { toolCalls: [{ ...change("three"), args: { ...change("three").args, old_string: "two" } }] },
      { text: "never" },
    ]);
    const permissions = new Permissions(memorySettings({}));
    const createSession = () =>
      new Session({
        client,
        model: "gpt-6-luna",
        instructions: "test",
        cwd,
        tools: defaultTools,
        approve: permissions.approve,
      });
    const { lastFrame, frames, stdin, unmount } = render(
      <App
        createSession={createSession}
        info={{ version: "0", model: "gpt-6-luna", shell: "bash", cwd }}
        permissions={permissions}
        {...signedIn()}
      />,
    );
    await tick();
    stdin.write("change a");
    await tick();
    stdin.write("\r");
    await waitFor(() => (lastFrame() ?? "").includes("Edit a.txt"));
    expect(lastFrame()).toContain("2. Yes, and don't ask again for file edits this session");
    expect(lastFrame()).toContain("Waiting for your answer");
    stdin.write("1");
    await waitFor(() => frames.join("\n").includes("changed it"));

    stdin.write("change it again");
    await tick();
    stdin.write("\r");
    await waitFor(() => (lastFrame() ?? "").includes("Edit a.txt"));
    stdin.write("\u001B");
    await waitFor(() => frames.join("\n").includes("Stopped. Tell Nimbus what to do instead."));
    expect(frames.join("\n")).toContain("Declined by you");
    unmount();
  });

  it("prints a long file above the box and holds the screen still while asking", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "nimbus-long-"));
    const content = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join("\n");
    const client = new FakeModelClient([
      { toolCalls: [{ name: "write_file", args: { path: "big.txt", content } }] },
      { text: "wrote it" },
    ]);
    const permissions = new Permissions(memorySettings({}));
    const createSession = () =>
      new Session({
        client,
        model: "gpt-6-luna",
        instructions: "test",
        cwd,
        tools: defaultTools,
        approve: permissions.approve,
      });
    const { lastFrame, frames, stdin, unmount } = render(
      <App
        createSession={createSession}
        info={{ version: "0", model: "gpt-6-luna", shell: "bash", cwd }}
        permissions={permissions}
        {...signedIn()}
      />,
    );
    await tick();
    stdin.write("write a big file");
    await tick();
    stdin.write("\r");
    await waitFor(() => (lastFrame() ?? "").includes("Write big.txt (30 lines)"));
    const all = frames.join("\n");
    expect(all).toContain("Full content of big.txt (only written if you say yes):");
    expect(all).toContain("line 30");
    expect(lastFrame()).toContain("more lines, shown in full above");
    expect(lastFrame()).toContain("◆ Waiting for your answer…");
    // No spinner or timer ticking while the box is open
    const count = frames.length;
    await new Promise((resolve) => setTimeout(resolve, 1300));
    expect(frames.length).toBe(count);
    stdin.write("1");
    await waitFor(() => frames.join("\n").includes("wrote it"));
    unmount();
  });

  it("steps through the permission modes with Shift+Tab", async () => {
    const settings = memorySettings({});
    const permissions = new Permissions(settings);
    const createSession = () =>
      new Session({
        client: new FakeModelClient([]),
        model: "gpt-6-luna",
        instructions: "t",
        cwd: tmpdir(),
      });
    const { lastFrame, stdin, unmount } = render(
      <App
        createSession={createSession}
        info={{ version: "0", model: "gpt-6-luna", shell: "bash", cwd: tmpdir() }}
        permissions={permissions}
        {...signedIn()}
      />,
    );
    await tick();
    stdin.write("half typed");
    await tick();
    stdin.write("\u001B[Z");
    await tick();
    expect(permissions.mode).toBe("edits");
    expect(lastFrame()).toContain("auto edits");
    stdin.write("\u001B[Z");
    await tick();
    expect(permissions.mode).toBe("full");
    expect(lastFrame()).toContain("don't ask");
    stdin.write("\u001B[Z");
    await tick();
    expect(permissions.mode).toBe("ask");
    expect(settings.load().permissions).toBe("ask");
    // The draft is untouched
    expect(lastFrame()).toContain("half typed");
    unmount();
  });

  it("switches the permission mode with /permissions", async () => {
    const permissions = new Permissions(memorySettings({}));
    const createSession = () =>
      new Session({
        client: new FakeModelClient([]),
        model: "gpt-6-luna",
        instructions: "t",
        cwd: tmpdir(),
      });
    const { lastFrame, frames, stdin, unmount } = render(
      <App
        createSession={createSession}
        info={{ version: "0", model: "gpt-6-luna", shell: "bash", cwd: tmpdir() }}
        permissions={permissions}
        {...signedIn()}
      />,
    );
    await tick();
    stdin.write("/permissions");
    await tick();
    stdin.write("\r");
    await waitFor(() => (lastFrame() ?? "").includes("When should Nimbus ask before acting?"));
    stdin.write("\u001B[B");
    await tick();
    stdin.write("\r");
    await waitFor(() => frames.join("\n").includes("Permissions: Edit files without asking"));
    expect(lastFrame()).toContain("auto edits · gpt-6-luna");
    expect(permissions.mode).toBe("edits");
    unmount();
  });

  it("shows and forgets saved facts with /memory, and sends the /init request", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nimbus-mem-"));
    const memory = new FileMemory(join(dir, "memory.md"), join(dir, "p", "memory.md"), "/proj");
    memory.save("The user tests with node --test", "user");
    memory.save("Prices are in rupees", "project");
    const client = new FakeModelClient([{ text: "Wrote AGENTS.md" }]);
    const createSession = () =>
      new Session({ client, model: "gpt-6-luna", instructions: "t", cwd: dir });
    const { lastFrame, frames, stdin, unmount } = render(
      <App
        createSession={createSession}
        info={{ version: "0", model: "gpt-6-luna", shell: "bash", cwd: dir }}
        memory={memory}
        {...signedIn()}
      />,
    );
    await tick();
    stdin.write("/memory");
    await tick();
    stdin.write("\r");
    await waitFor(() => (lastFrame() ?? "").includes("2. Prices are in rupees"));
    expect(lastFrame()).toContain("1. The user tests with node --test");
    stdin.write("/memory forget 1");
    await tick();
    stdin.write("\r");
    await waitFor(() => frames.join("\n").includes("Forgot: The user tests with node --test"));
    expect(memory.list()).toEqual({ user: [], project: ["Prices are in rupees"] });

    stdin.write("/init");
    await tick();
    stdin.write("\r");
    await waitFor(() => frames.join("\n").includes("Wrote AGENTS.md"));
    expect(client.requests[0]!.input[0]).toEqual({ role: "user", content: INIT_REQUEST });
    unmount();
  });

  it("lists skills with /skills and runs one with /name and text", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nimbus-skill-"));
    await mkdir(join(dir, ".nimbus", "skills", "review"), { recursive: true });
    await writeFile(
      join(dir, ".nimbus", "skills", "review", "SKILL.md"),
      "---\nname: review\ndescription: Review the staged changes\n---\nReview $ARGUMENTS now.\n",
    );
    const skills = loadSkills(dir, dir);
    const client = new FakeModelClient([{ text: "Reviewed" }]);
    const createSession = () =>
      new Session({ client, model: "gpt-6-luna", instructions: "t", cwd: dir, skills });
    const { lastFrame, frames, stdin, unmount } = render(
      <App
        createSession={createSession}
        info={{ version: "0", model: "gpt-6-luna", shell: "bash", cwd: dir }}
        {...signedIn()}
      />,
    );
    await tick();
    stdin.write("/skills");
    await tick();
    stdin.write("\r");
    await waitFor(() => frames.join("\n").includes("/review  Review the staged changes"));
    expect(frames.join("\n")).toContain("project skill, Nimbus can also use it on its own");
    expect(frames.join("\n")).toContain("/create-skill");

    stdin.write("/rev");
    await tick();
    expect(lastFrame()).toContain("Review the staged changes");
    stdin.write("iew the auth files");
    await tick();
    stdin.write("\r");
    await waitFor(() => frames.join("\n").includes("Reviewed"));
    expect(frames.join("\n")).toContain("/review the auth files");
    expect(client.requests[0]!.input[0]).toEqual({
      role: "user",
      content: skillRequest(skills[0]!, "the auth files"),
    });
    expect(skillRequest(skills[0]!, "the auth files")).toContain("Review the auth files now.");
    unmount();
  });

  it("switches the model and reasoning level with /model, and saves the choice", async () => {
    const settings = memorySettings({});
    const models = new ModelChoice(settings);
    const client = new FakeModelClient([{ text: "first" }, { text: "second" }]);
    const createSession = () =>
      new Session({
        client,
        model: models.model,
        effort: models.effort,
        instructions: "t",
        cwd: tmpdir(),
      });
    const { lastFrame, frames, stdin, unmount } = render(
      <App
        createSession={createSession}
        info={{ version: "0", model: models.model, shell: "bash", cwd: tmpdir() }}
        models={models}
        {...signedIn()}
      />,
    );
    await tick();
    expect(lastFrame()).toContain("gpt-6-luna · medium");
    stdin.write("hi");
    await tick();
    stdin.write("\r");
    await waitFor(() => frames.join("\n").includes("first"));
    expect(client.requests[0]!.effort).toBe("medium");

    stdin.write("/model");
    await tick();
    stdin.write("\r");
    await waitFor(() => (lastFrame() ?? "").includes("Choose a model"));
    expect(lastFrame()).toContain("gpt-6-luna");
    expect(lastFrame()).toContain("· current");
    // Three up from gpt-6-luna is the first model
    for (let i = 0; i < 3; i++) {
      stdin.write("\u001B[A");
      await tick();
    }
    expect(lastFrame()).toContain("› gpt-6.2-astra");
    stdin.write("\r");
    await waitFor(() => (lastFrame() ?? "").includes("How much should gpt-6.2-astra think?"));
    // Astra cannot turn thinking off
    expect(lastFrame()).not.toContain("No thinking");
    expect(lastFrame()).toContain("› medium");
    stdin.write("\u001B[B");
    await tick();
    stdin.write("\r");
    await waitFor(() => frames.join("\n").includes("Model: gpt-6.2-astra, high reasoning."));
    expect(lastFrame()).toContain("gpt-6.2-astra · high");
    expect(settings.load()).toMatchObject({ model: "gpt-6.2-astra", effort: "high" });

    stdin.write("again");
    await tick();
    stdin.write("\r");
    await waitFor(() => frames.join("\n").includes("second"));
    expect(client.requests[1]!.model).toBe("gpt-6.2-astra");
    expect(client.requests[1]!.effort).toBe("high");
    unmount();
  });

  it("sends the commit request on /commit and shows each model call on /trace", async () => {
    const client = new FakeModelClient([
      { toolCalls: [{ name: "glob", args: { pattern: "*.nothing", path: null } }] },
      { text: "Committed abc123" },
    ]);
    const createSession = () =>
      new Session({
        client,
        model: "gpt-6-luna",
        effort: "low",
        instructions: "t",
        cwd: tmpdir(),
        tools: defaultTools,
      });
    const { frames, stdin, unmount } = render(
      <App
        createSession={createSession}
        info={{ version: "0", model: "gpt-6-luna", shell: "bash", cwd: tmpdir() }}
        {...signedIn()}
      />,
    );
    await tick();
    stdin.write("/trace");
    await tick();
    stdin.write("\r");
    await waitFor(() => frames.join("\n").includes("No model calls yet."));

    stdin.write("/commit mention the login fix");
    await tick();
    stdin.write("\r");
    await waitFor(() => frames.join("\n").includes("Committed abc123"));
    expect(frames.join("\n")).toContain("/commit mention the login fix");
    expect(client.requests[0]!.input[0]).toEqual({
      role: "user",
      content: `${COMMIT_REQUEST}\n\nThe user added: mention the login fix`,
    });

    stdin.write("/trace");
    await tick();
    stdin.write("\r");
    await waitFor(() => frames.join("\n").includes("Reply 1: 2 model calls, 1 tool"));
    const all = frames.join("\n");
    expect(all).toContain("1. gpt-6-luna low");
    expect(all).toContain("2. gpt-6-luna low");
    stdin.write("/trace 7");
    await tick();
    stdin.write("\r");
    await waitFor(() => frames.join("\n").includes("Reply 7 has no saved model calls."));
    unmount();
  });

  it("names the chat in the background after a reply, and /rename sets the user's name", async () => {
    let made: Session | null = null;
    const client = new FakeModelClient([{ text: "Sure" }, { text: "Count JS files in src" }]);
    const createSession = () => {
      made = new Session({
        client,
        model: "gpt-6-luna",
        instructions: "t",
        cwd: tmpdir(),
        titles: true,
      });
      return made;
    };
    const { frames, stdin, unmount } = render(
      <App
        createSession={createSession}
        info={{ version: "0", model: "gpt-6-luna", shell: "bash", cwd: tmpdir() }}
        {...signedIn()}
      />,
    );
    await tick();
    stdin.write("how many js files are in src?");
    await tick();
    stdin.write("\r");
    await waitFor(() => made!.title === "Count JS files in src");
    stdin.write("/rename   My   JS count");
    await tick();
    stdin.write("\r");
    await waitFor(() => frames.join("\n").includes('Renamed this conversation to "My JS count".'));
    expect(made!.title).toBe("My JS count");
    stdin.write("/rename");
    await tick();
    stdin.write("\r");
    await waitFor(() => frames.join("\n").includes("Add the new name after the command"));
    unmount();
  });

  it("clears the screen with Ctrl+L but keeps the conversation", async () => {
    let made = 0;
    const client = new FakeModelClient([{ text: "first answer" }, { text: "second answer" }]);
    const createSession = () => {
      made += 1;
      return new Session({ client, model: "gpt-6-luna", instructions: "test", cwd: tmpdir() });
    };
    const { frames, stdin, unmount } = render(
      <App
        createSession={createSession}
        info={{ version: "0", model: "gpt-6-luna", shell: "bash", cwd: tmpdir() }}
        {...signedIn()}
      />,
    );
    await tick();
    stdin.write("hello");
    await tick();
    stdin.write("\r");
    await waitFor(() => frames.join("\n").includes("first answer"));
    const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    stdin.write("\f");
    await tick();
    expect(write).toHaveBeenCalledWith("\x1b[2J\x1b[3J\x1b[H");
    write.mockRestore();
    expect(made).toBe(1);
    stdin.write("again");
    await tick();
    stdin.write("\r");
    await waitFor(() => frames.join("\n").includes("second answer"));
    expect(made).toBe(1);

    stdin.write("/clear");
    await tick();
    stdin.write("\r");
    await tick();
    expect(made).toBe(2);
    unmount();
  });

  it("adds a new line with Shift+Enter and Ctrl+J instead of sending", async () => {
    const createSession = () =>
      new Session({
        client: new FakeModelClient([]),
        model: "gpt-6-luna",
        instructions: "test",
        cwd: tmpdir(),
      });
    const { lastFrame, frames, stdin, unmount } = render(
      <App
        createSession={createSession}
        info={{ version: "0", model: "gpt-6-luna", shell: "bash", cwd: tmpdir() }}
        {...signedIn()}
      />,
    );
    await tick();
    stdin.write("one");
    await tick();
    // Shift+Enter as the kitty keyboard protocol reports it
    stdin.write("\x1b[13;2u");
    await tick();
    stdin.write("two");
    await tick();
    stdin.write("\n");
    await tick();
    stdin.write("three");
    await tick();
    const frame = lastFrame() ?? "";
    expect(frame).toMatch(/one[^\n]*\n[^\n]*two[^\n]*\n[^\n]*three/);
    expect(frames.join("\n")).not.toContain("› one");
    unmount();
  });

  it("opens an earlier conversation with /resume and shows it again", async () => {
    const saved: SavedSession = {
      info: { id: "old", cwd: tmpdir(), model: "gpt-6-luna", title: "rename the helper" },
      createdAt: 0,
      updatedAt: Date.now() - 2 * 3_600_000,
      turns: [
        {
          turn: 1,
          status: "done",
          items: [
            { role: "user", content: "rename the helper" },
            { role: "assistant", content: "Renamed it to formatDate." },
          ],
          views: [],
          usage: { inputTokens: 10, cachedTokens: 0, cacheWriteTokens: 0, outputTokens: 2 },
          cost: 0,
        },
      ],
      fileChanges: [],
      compaction: null,
    };
    const sessions: SessionHistory = {
      list: () => [{ id: "old", title: "rename the helper", updatedAt: saved.updatedAt, turns: 1 }],
      load: (id) => (id === "old" ? saved : null),
    };
    const opened: (string | undefined)[] = [];
    const createSession = (from?: SavedSession) => {
      opened.push(from?.info.id);
      return new Session({
        client: new FakeModelClient([{ text: "Back again" }]),
        model: "gpt-6-luna",
        instructions: "test",
        cwd: tmpdir(),
        id: from?.info.id,
      });
    };
    const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const { lastFrame, frames, stdin, unmount } = render(
      <App
        createSession={createSession}
        info={{ version: "0", model: "gpt-6-luna", shell: "bash", cwd: tmpdir() }}
        {...signedIn()}
        sessions={sessions}
      />,
    );
    await tick();
    stdin.write("/resume");
    await tick();
    stdin.write("\r");
    await tick();
    expect(lastFrame()).toContain("Resume a conversation");
    expect(lastFrame()).toContain("2 hours ago · 1 message");
    stdin.write("\r");
    await waitFor(() => frames.join("\n").includes("Renamed it to formatDate."));
    write.mockRestore();
    expect(opened).toEqual([undefined, "old"]);
    expect(frames.join("\n")).toContain("Resumed this conversation from 2 hours ago.");
    unmount();
  });

  it("says so when there is nothing to resume", async () => {
    const { lastFrame, stdin, unmount } = render(
      <App
        createSession={() =>
          new Session({
            client: new FakeModelClient([]),
            model: "gpt-6-luna",
            instructions: "test",
            cwd: tmpdir(),
          })
        }
        info={{ version: "0", model: "gpt-6-luna", shell: "bash", cwd: tmpdir() }}
        {...signedIn()}
        sessions={{ list: () => [], load: () => null }}
      />,
    );
    await tick();
    stdin.write("/resume");
    await tick();
    stdin.write("\r");
    await waitFor(() => (lastFrame() ?? "").includes("No earlier conversations in this folder."));
    unmount();
  });

  it("shows the command menu and runs /help", async () => {
    const createSession = () =>
      new Session({
        client: new FakeModelClient([]),
        model: "gpt-6-luna",
        instructions: "test",
        cwd: tmpdir(),
      });
    const { lastFrame, frames, stdin, unmount } = render(
      <App
        createSession={createSession}
        info={{
          version: "0.0.0",
          model: "gpt-6-luna",
          shell: "bash",
          cwd: tmpdir(),
          route: "server",
        }}
        {...signedIn()}
      />,
    );
    await tick();
    stdin.write("/he");
    await tick();
    expect(lastFrame()).toContain("Show commands and shortcuts");
    stdin.write("\t");
    await tick();
    stdin.write("\r");
    await tick();
    expect(frames.join("\n")).toContain("Shortcuts");

    stdin.write("/");
    await tick();
    // Arrow down to /usage, wherever it sits in the list
    const steps = COMMANDS.findIndex((command) => command.name === "/usage");
    for (let i = 0; i < steps; i++) {
      stdin.write("\u001B[B");
      await tick();
    }
    expect(lastFrame()).toContain("› /usage");
    stdin.write("\r");
    await tick();
    expect(frames.join("\n")).toContain("Cost      $0.0000");
    unmount();
  });

  it("walks history with the arrows, even past a command", async () => {
    const createSession = () =>
      new Session({
        client: new FakeModelClient([{ text: "one" }]),
        model: "gpt-6-luna",
        instructions: "test",
        cwd: tmpdir(),
      });
    const { lastFrame, stdin, unmount } = render(
      <App
        createSession={createSession}
        info={{ version: "0", model: "gpt-6-luna", shell: "bash", cwd: tmpdir(), route: "server" }}
        {...signedIn()}
      />,
    );
    const input = () => (lastFrame() ?? "").split("\n").find((line) => line.includes("> ")) ?? "";
    await tick();
    stdin.write("first message");
    await tick();
    stdin.write("\r");
    await tick(300);
    stdin.write("/usage");
    await tick();
    stdin.write("\r");
    await tick();
    stdin.write("\u001B[A");
    await tick();
    expect(input()).toContain("/usage");
    expect(lastFrame()).not.toContain("Show tokens and cost");
    stdin.write("\u001B[A");
    await tick();
    expect(input()).toContain("first message");
    stdin.write("\u001B[B");
    await tick();
    expect(input()).toContain("/usage");
    unmount();
  });

  function loginSetup(turns: ConstructorParameters<typeof FakeModelClient>[0], saved = false) {
    const fake = new FakeModelClient(turns);
    const client = new SwitchableModelClient(() => fake);
    const auth = new AuthController({
      serverUrl: "http://server.test",
      store: memoryStore(saved ? { token: "nmb_old", email: "old@gmail.com" } : null),
      client,
      fetchFn: (async () => new Response(null, { status: 204 })) as typeof fetch,
      login: async ({ onUrl }) => {
        onUrl("http://server.test/auth/cli/start?port=1");
        await tick(30);
        return { token: "nmb_new", email: "new@gmail.com" };
      },
    });
    const createSession = () =>
      new Session({ client, model: "gpt-6-luna", instructions: "test", cwd: tmpdir() });
    return render(
      <App
        createSession={createSession}
        info={{
          version: "0.0.0",
          model: "gpt-6-luna",
          shell: "bash",
          cwd: tmpdir(),
          route: "server",
        }}
        auth={auth}
        billing={signedIn().billing}
      />,
    );
  }

  it("asks to log in, then sends the waiting message", async () => {
    const { frames, lastFrame, stdin, unmount } = loginSetup([{ text: "Done after login" }]);
    await tick();
    expect(lastFrame()).toContain("not logged in");
    stdin.write("fix the bug");
    await tick();
    stdin.write("\r");
    await tick();
    expect(lastFrame()).toContain("Log in to start using Nimbus.");
    stdin.write("\r");
    await waitFor(() => frames.join("\n").includes("Done after login"));
    const all = frames.join("\n");
    expect(all).toContain("Logged in as new@gmail.com");
    expect((lastFrame() ?? "").match(/› fix the bug/g)).toHaveLength(1);
    unmount();
  });

  it("asks to log in again when the server refuses the token", async () => {
    const { lastFrame, stdin, unmount } = loginSetup(
      [{ error: "Invalid or revoked Nimbus token.", status: 401 }],
      true,
    );
    await tick();
    expect(lastFrame()).toContain("old@gmail.com");
    stdin.write("hello");
    await tick();
    stdin.write("\r");
    await waitFor(() => (lastFrame() ?? "").includes("expired or was revoked"));
    unmount();
  });

  const KEY = "sk-test_aaaaaaaaaaaaaaaaaaaaaaaa1b2c";

  function billingSetup(options: {
    nimbus: ConstructorParameters<typeof FakeModelClient>[0];
    own?: ConstructorParameters<typeof FakeModelClient>[0];
    savedKey?: string | null;
    use?: "nimbus" | "key";
    loggedIn?: boolean;
  }) {
    const nimbusModel = new FakeModelClient(options.nimbus);
    const ownModel = new FakeModelClient(options.own ?? []);
    const switchable = new SwitchableModelClient(() => nimbusModel);
    const auth = new AuthController({
      serverUrl: "http://server.test",
      store: memoryStore(
        options.loggedIn === false ? null : { token: "nmb_t", email: "me@gmail.com" },
      ),
      client: switchable,
      fetchFn: (async () => Response.json({})) as unknown as typeof fetch,
      login: async () => ({ token: "nmb_new", email: "me@gmail.com" }),
    });
    const router = new RoutingModelClient(switchable, () => ownModel);
    const billing = new BillingController({
      keys: memorySecret(options.savedKey ?? null),
      settings: memorySettings(options.use ? { use: options.use } : {}),
      client: router,
      model: "gpt-6-luna",
      fetchFn: (async () => new Response("{}", { status: 200 })) as unknown as typeof fetch,
    });
    const createSession = () =>
      new Session({ client: router, model: "gpt-6-luna", instructions: "test", cwd: tmpdir() });
    const view = render(
      <App
        createSession={createSession}
        info={{ version: "0", model: "gpt-6-luna", shell: "bash", cwd: tmpdir() }}
        auth={auth}
        billing={billing}
      />,
    );
    return { ...view, billing, ownModel };
  }

  it("saves a pasted key without ever showing it", async () => {
    const { lastFrame, frames, stdin, billing, unmount } = billingSetup({ nimbus: [] });
    await tick();
    stdin.write("/key");
    await tick();
    stdin.write("\r");
    await tick();
    expect(lastFrame()).toContain("Paste your OpenAI API key");
    stdin.write(KEY);
    await tick();
    expect(frames.join("\n")).not.toContain(KEY);
    expect(lastFrame()).toContain("•••••");
    stdin.write("\r");
    await waitFor(() => (lastFrame() ?? "").includes("Saved your OpenAI key (sk-...1b2c)"));
    expect(billing.state.route).toBe("key");
    stdin.write("\u001B[A");
    await tick();
    expect(frames.join("\n")).not.toContain(KEY);
    unmount();
  });

  it("switches to the user's key when Nimbus credit runs out", async () => {
    const { lastFrame, stdin, billing, unmount } = billingSetup({
      nimbus: [{ error: "Your Nimbus trial credit is used up ($0.50).", status: 402 }],
      own: [{ text: "Answer paid by your key" }],
      savedKey: KEY,
    });
    await tick();
    stdin.write("hello");
    await tick();
    stdin.write("\r");
    await waitFor(() => (lastFrame() ?? "").includes("Answer paid by your key"));
    const frame = lastFrame() ?? "";
    expect(frame).toContain("switched to your OpenAI key");
    expect(frame.match(/› hello/g)).toHaveLength(1);
    expect(billing.state.route).toBe("key");
    unmount();
  });

  it("continues the same turn after switching, without sending the message twice", async () => {
    const { lastFrame, stdin, ownModel, unmount } = billingSetup({
      nimbus: [
        { toolCalls: [{ name: "read_file", args: { path: "a.txt" } }] },
        { error: "Your Nimbus trial credit is used up ($0.50).", status: 402 },
      ],
      own: [{ text: "Finished on your key" }],
      savedKey: KEY,
    });
    await tick();
    stdin.write("hello");
    await tick();
    stdin.write("\r");
    await waitFor(() => (lastFrame() ?? "").includes("Finished on your key"));
    const input = ownModel.requests[0]!.input;
    expect(input.filter((item) => "role" in item && item.role === "user")).toEqual([
      { role: "user", content: "hello" },
    ]);
    expect(input.some((item) => item.type === "function_call_output")).toBe(true);
    unmount();
  });

  it("switches back to Nimbus credit when the key runs out", async () => {
    const { lastFrame, stdin, billing, unmount } = billingSetup({
      nimbus: [{ text: "Answer paid by Nimbus" }],
      own: [{ error: "You exceeded your quota", status: 429, code: "insufficient_quota" }],
      savedKey: KEY,
      use: "key",
    });
    await tick();
    stdin.write("hello");
    await tick();
    stdin.write("\r");
    await waitFor(() => (lastFrame() ?? "").includes("Answer paid by Nimbus"));
    expect(lastFrame()).toContain("out of credit, switched to Nimbus credit");
    expect(billing.state.route).toBe("nimbus");
    unmount();
  });

  it("suggests /key when Nimbus credit runs out and there is no key", async () => {
    const { lastFrame, stdin, unmount } = billingSetup({
      nimbus: [{ error: "Your Nimbus trial credit is used up ($0.50).", status: 402 }],
    });
    await tick();
    stdin.write("hello");
    await tick();
    stdin.write("\r");
    await waitFor(() => (lastFrame() ?? "").includes("Add your own OpenAI key with /key"));
    unmount();
  });

  it("works with the user's key without a login", async () => {
    const { lastFrame, stdin, unmount } = billingSetup({
      nimbus: [],
      own: [{ text: "No login needed" }],
      savedKey: KEY,
      use: "key",
      loggedIn: false,
    });
    await tick();
    stdin.write("hello");
    await tick();
    stdin.write("\r");
    await waitFor(() => (lastFrame() ?? "").includes("No login needed"));
    expect(lastFrame()).not.toContain("Log in to start");
    unmount();
  });

  it("switches with the /use menu", async () => {
    const { lastFrame, stdin, billing, unmount } = billingSetup({ nimbus: [], savedKey: KEY });
    await tick();
    stdin.write("/use");
    await tick();
    stdin.write("\r");
    await tick();
    expect(lastFrame()).toContain("Pay for model calls with");
    stdin.write("\u001B[B");
    await tick();
    stdin.write("\r");
    await waitFor(() => billing.state.route === "key");
    expect(lastFrame()).toContain("Using your OpenAI key.");
    unmount();
  });
});
