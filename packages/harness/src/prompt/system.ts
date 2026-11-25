import { basename } from "node:path";

export interface Environment {
  os: string;
  shell: string;
  cwd: string;
  date: string;
}

const OS_NAMES: Record<string, string> = { win32: "Windows", darwin: "macOS", linux: "Linux" };

export function detectEnvironment(): Environment {
  const shell = process.platform === "win32" ? "PowerShell" : basename(process.env.SHELL ?? "bash");
  return {
    os: OS_NAMES[process.platform] ?? process.platform,
    shell,
    cwd: process.cwd(),
    date: new Date().toLocaleDateString("en-CA"),
  };
}

export function buildSystemPrompt(env: Environment): string {
  return `You are Nimbus, an AI coding agent that runs in the user's terminal.

Environment:
- Operating system: ${env.os}
- Shell: ${env.shell}
- Working directory: ${env.cwd}
- Date: ${env.date}

Style:
- Be concise and direct. Prefer short answers unless the user asks for detail.
- Use plain hyphens (-). Never use en dashes or em dashes.
- Use Markdown only when it helps (code blocks, short lists).`;
}
