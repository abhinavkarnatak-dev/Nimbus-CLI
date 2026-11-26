import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { basename, dirname, join } from "node:path";

export interface ShellInfo {
  name: string;
  path: string;
  args(command: string): string[];
}

const bashArgs = (command: string) => ["-c", command];
const powerShellArgs = (command: string) => ["-NoProfile", "-NonInteractive", "-Command", command];

function gitBashCandidates(): string[] {
  const candidates = [
    process.env.NIMBUS_GIT_BASH_PATH,
    process.env.ProgramFiles && join(process.env.ProgramFiles, "Git", "bin", "bash.exe"),
    process.env["ProgramFiles(x86)"] &&
      join(process.env["ProgramFiles(x86)"], "Git", "bin", "bash.exe"),
    process.env.LOCALAPPDATA &&
      join(process.env.LOCALAPPDATA, "Programs", "Git", "bin", "bash.exe"),
  ];
  try {
    const gitPath = execFileSync("where", ["git"], { encoding: "utf8", windowsHide: true })
      .split(/\r?\n/)[0]
      ?.trim();
    if (gitPath) candidates.push(join(dirname(dirname(gitPath)), "bin", "bash.exe"));
  } catch {
    // git not on PATH
  }
  return candidates.filter((path): path is string => Boolean(path));
}

// Git Bash, PowerShell, or the user's shell
export function detectShell(): ShellInfo {
  if (process.platform === "win32") {
    const gitBash = gitBashCandidates().find((path) => existsSync(path));
    if (gitBash) return { name: "Git Bash (bash)", path: gitBash, args: bashArgs };
    return { name: "PowerShell", path: "powershell.exe", args: powerShellArgs };
  }

  const userShell = process.env.SHELL;
  const name = userShell ? basename(userShell) : "";
  if (userShell && (name === "bash" || name === "zsh") && existsSync(userShell)) {
    return { name, path: userShell, args: bashArgs };
  }
  return { name: "bash", path: "/bin/bash", args: bashArgs };
}
