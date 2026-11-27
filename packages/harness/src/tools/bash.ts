import { stripVTControlCharacters } from "node:util";
import { z } from "zod";
import { blockedReason } from "./blocklist.js";
import { killTree, spawnShell, type ProcessSnapshot } from "./processes.js";
import { defineTool, type ToolContext } from "./types.js";

export const DEFAULT_TIMEOUT_MS = 120_000;
export const MAX_TIMEOUT_MS = 600_000;
const BACKGROUND_WAIT_MS = 3_000;
const MAX_CAPTURE = 1024 * 1024;
const PREVIEW_LINES = 6;

function preview(output: string): string | undefined {
  const lines = output
    .trimEnd()
    .split(/\r?\n/)
    .filter((line) => line.trim() !== "");
  if (lines.length === 0) return undefined;
  const shown = lines.slice(0, PREVIEW_LINES);
  const more = lines.length - shown.length;
  return shown.join("\n") + (more > 0 ? `\n… ${more} more lines` : "");
}

function requireShell(ctx: ToolContext) {
  if (!ctx.shell || !ctx.processes) throw new Error("running commands is not available here");
  return { shell: ctx.shell, processes: ctx.processes };
}

function describeSnapshot(snapshot: ProcessSnapshot): string {
  const status = snapshot.running
    ? "Status: still running."
    : `Status: exited with code ${snapshot.exitCode ?? "unknown"}.`;
  const output = snapshot.output.trimEnd() || "(no new output)";
  return `${output}\n\n${status}`;
}

// Run a foreground command to completion
async function runForeground(
  command: string,
  timeoutMs: number,
  ctx: ToolContext,
): Promise<{ output: string; code: number | null; timedOut: boolean }> {
  const { shell } = requireShell(ctx);
  const child = spawnShell(shell, command, ctx.cwd);
  let output = "";
  let timedOut = false;

  const append = (chunk: Buffer) => {
    if (output.length < MAX_CAPTURE) output += chunk.toString();
  };
  child.stdout?.on("data", append);
  child.stderr?.on("data", append);

  const timer = setTimeout(() => {
    timedOut = true;
    void killTree(child);
  }, timeoutMs);
  const onAbort = () => void killTree(child);
  ctx.signal.addEventListener("abort", onAbort, { once: true });

  try {
    const code = await new Promise<number | null>((resolve, reject) => {
      child.on("error", reject);
      child.on("close", (exitCode) => resolve(exitCode));
    });
    ctx.signal.throwIfAborted();
    return { output: stripVTControlCharacters(output), code, timedOut };
  } finally {
    clearTimeout(timer);
    ctx.signal.removeEventListener("abort", onAbort);
  }
}

export const bashTool = defineTool({
  name: "bash",
  needsApproval: true,
  description: `Run a command in the user's shell, starting in the working directory.
Returns the combined output and the exit code.
- command: the command to run.
- timeout_ms: stop the command after this many milliseconds. Use null for the
  default (120000). Maximum 600000.
- background: true to start a long-running command (like a dev server) and
  return right away with a process id. Use null for false.`,
  schema: z.strictObject({
    command: z.string(),
    timeout_ms: z.number().nullable(),
    background: z.boolean().nullable(),
  }),
  async run({ command, timeout_ms, background }, ctx) {
    const reason = blockedReason(command);
    if (reason) {
      throw new Error(
        `this command is blocked for safety (${reason}). Ask the user to run it themselves if it is really needed`,
      );
    }

    if (background) {
      const { shell, processes } = requireShell(ctx);
      const id = processes.start(shell, command, ctx.cwd);
      await processes.waitFor(id, BACKGROUND_WAIT_MS);
      const snapshot = processes.readNew(id);
      const header = snapshot.running
        ? `Started ${id} in the background. Use bash_output to read more output and kill_process to stop it.`
        : `${id} exited right away with code ${snapshot.exitCode ?? "unknown"}.`;
      return {
        output: `${header}\n\nFirst output:\n${snapshot.output.trimEnd() || "(none yet)"}`,
        summary: snapshot.running ? `started ${id}` : `exit ${snapshot.exitCode ?? "?"}`,
        isError: !snapshot.running && snapshot.exitCode !== 0,
        preview: preview(snapshot.output),
      };
    }

    const timeoutMs = Math.min(Math.max(timeout_ms ?? DEFAULT_TIMEOUT_MS, 1), MAX_TIMEOUT_MS);
    const { output, code, timedOut } = await runForeground(command, timeoutMs, ctx);
    const body = output.trimEnd() || "(no output)";
    if (timedOut) {
      return {
        output: `${body}\n\nTimed out after ${timeoutMs} ms and was stopped. For long-running commands, use background: true.`,
        summary: "timed out",
        isError: true,
        preview: preview(output),
      };
    }
    return {
      output: `${body}\n\nExit code: ${code ?? "unknown"}`,
      summary: `exit ${code ?? "?"}`,
      isError: code !== 0,
      preview: preview(output),
    };
  },
});

const idSchema = z.strictObject({ id: z.string() });

export const bashOutputTool = defineTool({
  name: "bash_output",
  description: `Read new output from a background process started with bash, and whether it is
still running.
- id: the process id, for example "proc_1".`,
  schema: idSchema,
  async run({ id }, ctx) {
    const snapshot = requireShell(ctx).processes.readNew(id);
    return {
      output: describeSnapshot(snapshot),
      summary: snapshot.running ? "running" : `exit ${snapshot.exitCode ?? "?"}`,
      preview: preview(snapshot.output),
    };
  },
});

export const killProcessTool = defineTool({
  name: "kill_process",
  description: `Stop a background process started with bash, including its child processes.
- id: the process id, for example "proc_1".`,
  schema: idSchema,
  async run({ id }, ctx) {
    const snapshot = await requireShell(ctx).processes.kill(id);
    return { output: `Stopped ${id}.\n\n${describeSnapshot(snapshot)}`, summary: "stopped" };
  },
});
