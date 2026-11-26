import { spawn, type ChildProcess } from "node:child_process";
import { stripVTControlCharacters } from "node:util";
import treeKill from "tree-kill";
import type { ShellInfo } from "./shell.js";

const MAX_BUFFER = 1024 * 1024;

export interface ProcessSnapshot {
  id: string;
  command: string;
  output: string;
  running: boolean;
  exitCode: number | null;
}

interface ManagedProcess {
  id: string;
  command: string;
  child: ChildProcess;
  output: string;
  readFrom: number;
  dropped: number;
  exitCode: number | null;
  running: boolean;
  exited: Promise<void>;
}

// Env for child shells, without our secrets
export function childEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (/^(OPENAI_|NIMBUS_)/i.test(key)) continue;
    env[key] = value;
  }
  return { ...env, PAGER: "cat", GIT_PAGER: "cat", NO_COLOR: "1", FORCE_COLOR: "0" };
}

export function killTree(child: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (child.pid === undefined || child.exitCode !== null) return resolve();
    treeKill(child.pid, "SIGKILL", () => resolve());
  });
}

export function spawnShell(shell: ShellInfo, command: string, cwd: string): ChildProcess {
  return spawn(shell.path, shell.args(command), {
    cwd,
    env: childEnv(),
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
}

// Tracks background processes per session
export class ProcessManager {
  readonly #processes = new Map<string, ManagedProcess>();
  #nextId = 1;

  start(shell: ShellInfo, command: string, cwd: string): string {
    const id = `proc_${this.#nextId++}`;
    const child = spawnShell(shell, command, cwd);
    const entry: ManagedProcess = {
      id,
      command,
      child,
      output: "",
      readFrom: 0,
      dropped: 0,
      exitCode: null,
      running: true,
      exited: Promise.resolve(),
    };
    const append = (chunk: Buffer) => {
      entry.output += stripVTControlCharacters(chunk.toString());
      if (entry.output.length > MAX_BUFFER) {
        const cut = entry.output.length - MAX_BUFFER;
        entry.output = entry.output.slice(cut);
        entry.dropped += cut;
      }
    };
    child.stdout?.on("data", append);
    child.stderr?.on("data", append);
    entry.exited = new Promise((resolve) => {
      child.on("close", (code) => {
        entry.running = false;
        entry.exitCode = code;
        resolve();
      });
      child.on("error", (error) => {
        append(Buffer.from(`\n${error.message}\n`));
        entry.running = false;
        resolve();
      });
    });
    this.#processes.set(id, entry);
    return id;
  }

  async waitFor(id: string, ms: number): Promise<void> {
    const entry = this.#get(id);
    await Promise.race([entry.exited, new Promise((resolve) => setTimeout(resolve, ms))]);
  }

  // New output since the last read
  readNew(id: string): ProcessSnapshot {
    const entry = this.#get(id);
    const start = Math.max(0, entry.readFrom - entry.dropped);
    const output = entry.output.slice(start);
    entry.readFrom = entry.dropped + entry.output.length;
    return {
      id,
      command: entry.command,
      output,
      running: entry.running,
      exitCode: entry.exitCode,
    };
  }

  async kill(id: string): Promise<ProcessSnapshot> {
    const entry = this.#get(id);
    if (entry.running) {
      await killTree(entry.child);
      await entry.exited;
    }
    return this.readNew(id);
  }

  async killAll(): Promise<void> {
    await Promise.all(
      [...this.#processes.values()]
        .filter((entry) => entry.running)
        .map(async (entry) => {
          await killTree(entry.child);
          await entry.exited;
        }),
    );
  }

  #get(id: string): ManagedProcess {
    const entry = this.#processes.get(id);
    if (!entry) throw new Error(`no background process with id ${id}`);
    return entry;
  }
}
