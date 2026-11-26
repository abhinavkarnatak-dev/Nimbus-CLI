import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { rgPath } from "@vscode/ripgrep";

export const BASE_RIPGREP_ARGS = [
  "--no-config",
  "--color=never",
  "--no-require-git",
  "--hidden",
  "--path-separator=/",
];

export const ALWAYS_EXCLUDED = ["--glob=!.git/", "--glob=!node_modules/"];

export interface RipgrepRun {
  lines: string[];
  more: boolean;
  code: number | null;
  stderr: string;
}

// Run ripgrep, keep accepted lines
export function runRipgrep(
  args: string[],
  cwd: string,
  signal: AbortSignal,
  maxLines: number,
  accept: (line: string) => boolean = () => true,
): Promise<RipgrepRun> {
  return new Promise((resolve, reject) => {
    const child = spawn(rgPath, args, { cwd, signal, windowsHide: true });
    const lines: string[] = [];
    let more = false;
    let stderr = "";

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    createInterface({ input: child.stdout }).on("line", (raw) => {
      const line = raw.replace(/^\.\//, "");
      if (more || !accept(line)) return;
      if (lines.length < maxLines) {
        lines.push(line);
      } else {
        more = true;
        child.kill();
      }
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ lines, more, code, stderr }));
  });
}
