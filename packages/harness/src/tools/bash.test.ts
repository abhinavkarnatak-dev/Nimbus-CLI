import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { bashOutputTool, bashTool, killProcessTool } from "./bash.js";
import { blockedReason } from "./blocklist.js";
import { FileTracker } from "./file-state.js";
import { ProcessManager } from "./processes.js";
import { detectShell } from "./shell.js";

let root: string;
let processes: ProcessManager;
const shell = detectShell();

const ctx = (signal = new AbortController().signal) => ({
  cwd: root,
  signal,
  files: new FileTracker(),
  shell,
  processes,
});
const bash = (command: string, options: { timeout_ms?: number; background?: boolean } = {}) =>
  bashTool.execute(
    JSON.stringify({
      command,
      timeout_ms: options.timeout_ms ?? null,
      background: options.background ?? null,
    }),
    ctx(),
  );

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "nimbus-bash-"));
});

afterEach(async () => {
  await processes?.killAll();
  processes = new ProcessManager();
});

processes = new ProcessManager();

describe("bash", () => {
  it("runs a command and reports output and exit code", async () => {
    const result = await bash('node -e "console.log(41 + 1)"');
    expect(result.output).toContain("42");
    expect(result.output).toContain("Exit code: 0");
    expect(result.summary).toBe("exit 0");
    expect(result.isError).toBe(false);
  });

  it("reports non-zero exit codes", async () => {
    const result = await bash("node -e \"console.error('boom'); process.exit(3)\"");
    expect(result.output).toContain("boom");
    expect(result.output).toContain("Exit code: 3");
    expect(result.isError).toBe(true);
  });

  it("starts in the working directory", async () => {
    const result = await bash('node -e "console.log(process.cwd())"');
    expect(result.output.toLowerCase()).toContain(root.toLowerCase().split(/[\\/]/).at(-1));
  });

  it("does not pass our secrets to commands", async () => {
    process.env.OPENAI_API_KEY = "sk-test-secret";
    const result = await bash("node -e \"console.log(process.env.OPENAI_API_KEY ?? 'missing')\"");
    expect(result.output).toContain("missing");
    expect(result.output).not.toContain("sk-test-secret");
  });

  it("gives commands no input so they cannot hang", async () => {
    const result = await bash(
      "node -e \"process.stdin.on('data', () => {}); process.stdin.on('end', () => console.log('no input'))\"",
    );
    expect(result.output).toContain("no input");
  });

  it("stops commands that run past the timeout", async () => {
    const started = Date.now();
    const result = await bash('node -e "setTimeout(() => {}, 20000)"', { timeout_ms: 500 });
    expect(Date.now() - started).toBeLessThan(10_000);
    expect(result.output).toContain("Timed out after 500 ms");
    expect(result.summary).toBe("timed out");
  });

  it("stops a running command when the turn is cancelled", async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 300);
    const run = bashTool.execute(
      JSON.stringify({
        command: 'node -e "setTimeout(() => {}, 20000)"',
        timeout_ms: null,
        background: null,
      }),
      ctx(controller.signal),
    );
    await expect(run).rejects.toThrow();
  });

  it("refuses blocked commands", async () => {
    const result = await bash("git push --force origin main");
    expect(result.isError).toBe(true);
    expect(result.output).toContain("blocked for safety");
  });

  it("runs, reads and kills background processes", async () => {
    const started = await bash(
      "node -e \"console.log('ready'); setInterval(() => console.log('tick'), 100)\"",
      { background: true },
    );
    expect(started.output).toContain("Started proc_1 in the background");
    expect(started.output).toContain("ready");

    await new Promise((resolve) => setTimeout(resolve, 300));
    const more = await bashOutputTool.execute(JSON.stringify({ id: "proc_1" }), ctx());
    expect(more.output).toContain("tick");
    expect(more.output).toContain("still running");

    const stopped = await killProcessTool.execute(JSON.stringify({ id: "proc_1" }), ctx());
    expect(stopped.output).toContain("Stopped proc_1");
    expect(stopped.output).toContain("exited");
  });

  it("reports background commands that exit right away", async () => {
    const result = await bash('node -e "process.exit(2)"', { background: true });
    expect(result.output).toContain("exited right away with code 2");
  });
});

describe("blockedReason", () => {
  it.each([
    "rm -rf /",
    "rm -rf ~",
    "sudo rm -rf /*",
    "rm -fr .",
    "cd src && rm -rf *",
    "rm --recursive --force $HOME",
    "git push --force origin main",
    "git push -f",
    "git push --force-with-lease",
    "git reset --hard HEAD~3",
    "git clean -fdx",
    "shutdown /s",
    "format C:",
    "Remove-Item -Recurse -Force C:\\",
    "rmdir /s /q C:\\",
  ])("blocks %s", (command) => {
    expect(blockedReason(command)).toBeDefined();
  });

  it.each([
    "rm -rf dist",
    "rm -rf node_modules",
    "rm src/old.ts",
    "git push origin main",
    "git reset --soft HEAD~1",
    "git clean -n",
    "pnpm format",
    "npm run build",
    "Remove-Item -Recurse dist",
  ])("allows %s", (command) => {
    expect(blockedReason(command)).toBeUndefined();
  });
});
