import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultTools, FakeModelClient, Session } from "@nimbus/harness";
import { render } from "ink-testing-library";
import { describe, expect, it } from "vitest";
import { SwitchableModelClient } from "../src/auth/client.js";
import { AuthController } from "../src/auth/controller.js";
import { memoryStore } from "../src/auth/credentials.js";
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
        info={{
          version: "0.0.0",
          model: "gpt-6-luna",
          shell: "bash",
          cwd,
          route: "direct to OpenAI",
        }}
        onExit={() => {}}
        auth={null}
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
        info={{
          version: "0.0.0",
          model: "gpt-6-luna",
          shell: "bash",
          cwd: tmpdir(),
          route: "direct to OpenAI",
        }}
        onExit={() => {}}
        auth={null}
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
        onExit={() => {}}
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
});
