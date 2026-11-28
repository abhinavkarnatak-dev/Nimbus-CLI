import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createInterface } from "node:readline";

// Shown when neither the bundled nor a system ripgrep exists
export const RIPGREP_MISSING =
  "File search needs ripgrep, which was not installed with Nimbus. Fix it by installing Nimbus again with npm install -g @abhinavk-dev/nimbus, or install ripgrep so that rg is on your PATH.";

// The bundled binary, else one on the PATH
export function ripgrepCommand(bundled: string | null): string {
  return bundled && existsSync(bundled) ? bundled : "rg";
}

let bundledPath: Promise<string | null> | null = null;

// Loaded lazily: the package throws when its binary was not installed
function bundledRipgrep(): Promise<string | null> {
  bundledPath ??= import("@vscode/ripgrep").then(
    (module) => module.rgPath,
    () => null,
  );
  return bundledPath;
}

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
  return bundledRipgrep().then((bundled) =>
    run(ripgrepCommand(bundled), args, cwd, signal, maxLines, accept),
  );
}

function run(
  command: string,
  args: string[],
  cwd: string,
  signal: AbortSignal,
  maxLines: number,
  accept: (line: string) => boolean,
): Promise<RipgrepRun> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, signal, windowsHide: true });
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
    child.on("error", (error: NodeJS.ErrnoException) =>
      reject(error.code === "ENOENT" ? new Error(RIPGREP_MISSING) : error),
    );
    child.on("close", (code) => resolve({ lines, more, code, stderr }));
  });
}
