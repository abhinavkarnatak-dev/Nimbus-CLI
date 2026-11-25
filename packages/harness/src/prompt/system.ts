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

// Only describe tools that exist
function toolsSection(tools: ReadonlySet<string>): string {
  if (tools.size === 0) return "";

  const find: string[] = [];
  if (tools.has("glob")) {
    find.push('- Know the file name or part of it: use glob, for example "**/session*.ts".');
  }
  if (tools.has("grep")) {
    find.push(
      '- Know a word, function or error message: use grep, for example the pattern\n  "abortSignal|AbortController" with output_mode "content".',
    );
  }
  if (tools.has("read_file")) {
    find.push(
      tools.has("grep")
        ? "- Need to understand a file: use read_file on the part you need. For large\n  files, grep first to find the line, then read around it with offset and limit."
        : "- Need to understand a file: use read_file on the part you need. For large\n  files, read it in parts with offset and limit.",
    );
  }

  return `

Tools:
You can read and search files in the working directory. Use them to answer
from the real code, not from memory.

How to find things:
${find.join("\n")}

Working well:
- Start broad, then narrow. One good search is better than reading many files.
- Do not read the same file part twice. Reuse what you already read.
- Never guess what a file contains. If you have not read it, say so or read it.
- If a search finds nothing, try one or two other spellings or patterns, then
  tell the user what you searched for.
- Stop using tools as soon as you have enough to answer.

Answering:
- Paths are relative to the working directory and use forward slashes.
- When you mention code, include the path and line, like src/agent/session.ts:42.
- Quote only the few lines that matter, not whole files.`;
}

export function buildSystemPrompt(env: Environment, toolNames: readonly string[] = []): string {
  return `You are Nimbus, an AI coding agent that runs in the user's terminal.

Environment:
- Operating system: ${env.os}
- Shell: ${env.shell}
- Working directory: ${env.cwd}
- Date: ${env.date}

Style:
- Be concise and direct. Prefer short answers unless the user asks for detail.
- Use plain hyphens (-). Never use en dashes or em dashes.
- Use Markdown only when it helps (code blocks, short lists).${toolsSection(new Set(toolNames))}`;
}
