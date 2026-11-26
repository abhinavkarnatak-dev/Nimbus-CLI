import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultTools, FakeModelClient, Session } from "@nimbus/harness";
import { render } from "ink-testing-library";
import { describe, expect, it } from "vitest";
import { App } from "../src/ui/App.js";

const tick = (ms = 80) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(check: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error("Timed out waiting for the UI");
    await tick(20);
  }
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
        info={{ version: "0.0.0", model: "gpt-6-luna", shell: "bash", cwd }}
        onExit={() => {}}
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
    expect(lastFrame()).toContain("1.2k tokens");
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
        info={{ version: "0.0.0", model: "gpt-6-luna", shell: "bash", cwd: tmpdir() }}
        onExit={() => {}}
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
    stdin.write("\u001B[B");
    await tick();
    stdin.write("\u001B[B");
    await tick();
    expect(lastFrame()).toContain("› /usage");
    stdin.write("\r");
    await tick();
    expect(frames.join("\n")).toContain("Cost $0.0000");
    unmount();
  });
});
