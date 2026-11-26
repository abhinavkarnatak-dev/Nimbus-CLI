import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultTools, FakeModelClient, Session } from "@nimbus/harness";
import { render } from "ink-testing-library";
import { describe, expect, it } from "vitest";
import { SwitchableModelClient } from "../src/auth/client.js";
import { AuthController } from "../src/auth/controller.js";
import { memoryStore } from "../src/auth/credentials.js";
import { memorySecret } from "../src/auth/secrets.js";
import { BillingController } from "../src/billing/controller.js";
import { RoutingModelClient } from "../src/billing/router.js";
import { memorySettings } from "../src/settings.js";
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
    return { ...view, billing };
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
