import { homedir } from "node:os";

export function formatTokens(count: number): string {
  if (count < 1000) return String(count);
  if (count < 1_000_000) return `${(count / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return `${(count / 1_000_000).toFixed(2).replace(/\.?0+$/, "")}M`;
}

export function formatCost(cost: number): string {
  return cost < 0.01 ? `$${cost.toFixed(4)}` : `$${cost.toFixed(2)}`;
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

export function shortenPath(path: string): string {
  const home = homedir();
  const shown = path.toLowerCase().startsWith(home.toLowerCase())
    ? `~${path.slice(home.length)}`
    : path;
  return shown.replaceAll("\\", "/");
}

function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

function parseArgs(args: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(args);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

// Human label for a tool call
export function toolLabel(name: string, rawArgs: string): { verb: string; target: string } {
  const args = parseArgs(rawArgs);
  const str = (key: string) => (typeof args[key] === "string" ? (args[key] as string) : "");
  switch (name) {
    case "read_file": {
      const offset = typeof args.offset === "number" ? args.offset : null;
      const limit = typeof args.limit === "number" ? args.limit : null;
      const range =
        offset || limit ? ` (lines ${offset ?? 1}-${(offset ?? 1) + (limit ?? 2000) - 1})` : "";
      return { verb: "Read", target: str("path") + range };
    }
    case "glob":
      return { verb: "Glob", target: str("pattern") + (str("path") ? ` in ${str("path")}` : "") };
    case "grep":
      return {
        verb: "Grep",
        target: `"${clip(str("pattern"), 40)}"` + (str("path") ? ` in ${str("path")}` : ""),
      };
    case "edit":
      return { verb: "Edit", target: str("path") };
    case "write_file":
      return { verb: "Write", target: str("path") };
    case "bash":
      return { verb: args.background ? "Start" : "Bash", target: clip(str("command"), 70) };
    case "bash_output":
      return { verb: "Output", target: str("id") };
    case "kill_process":
      return { verb: "Stop", target: str("id") };
    case "web_search":
      return { verb: "Search", target: `"${clip(str("query"), 60)}"` };
    case "undo_changes": {
      const replies = typeof args.replies === "number" ? args.replies : 1;
      const paths = Array.isArray(args.paths)
        ? args.paths.filter((p) => typeof p === "string")
        : [];
      const scope = paths.length
        ? paths.join(", ")
        : replies === 1
          ? "last reply"
          : `last ${replies} replies`;
      return { verb: "Undo", target: clip(scope, 70) };
    }
    default:
      return { verb: name, target: clip(rawArgs, 60) };
  }
}

export interface DiffLine {
  kind: "add" | "remove" | "context";
  number: number;
  text: string;
}

// Unified diff into numbered lines
export function parseDiff(diff: string): DiffLine[] {
  const lines: DiffLine[] = [];
  let oldLine = 0;
  let newLine = 0;
  for (const line of diff.split("\n")) {
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunk) {
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
      continue;
    }
    if (line.startsWith("---") || line.startsWith("+++")) continue;
    if (line.startsWith("+")) lines.push({ kind: "add", number: newLine++, text: line.slice(1) });
    else if (line.startsWith("-"))
      lines.push({ kind: "remove", number: oldLine++, text: line.slice(1) });
    else if (line.startsWith(" ")) {
      lines.push({ kind: "context", number: newLine, text: line.slice(1) });
      oldLine++;
      newLine++;
    }
  }
  return lines;
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

// Short harness summary into a readable line
export function describeResult(name: string, summary: string, isError: boolean): string {
  const first = summary.split("\n")[0] ?? "";
  if (isError && name !== "bash") return first.replace(/^Error:\s*/, "");
  const change = /^\+(\d+) -(\d+)$/.exec(first);
  if (change) {
    const added = Number(change[1]);
    const removed = Number(change[2]);
    const parts = [added && plural(added, "addition"), removed && plural(removed, "removal")];
    return `Changed with ${parts.filter(Boolean).join(" and ") || "no line changes"}`;
  }
  switch (name) {
    case "read_file":
      return first === "empty file" ? "Empty file" : `Read ${first}`;
    case "glob":
    case "grep":
    case "web_search":
      return `Found ${first}`;
    case "write_file":
      return first.replace(/^created, /, "Created with ");
    case "bash":
    case "bash_output": {
      const exit = /^exit (.+)$/.exec(first);
      if (exit) return `Exit code ${exit[1]}`;
      if (first.startsWith("started ")) return `Running in background as ${first.slice(8)}`;
      if (first === "running") return "Still running";
      if (first === "timed out") return "Timed out and stopped";
      return first;
    }
    case "kill_process":
      return first === "stopped" ? "Stopped" : first;
    case "undo_changes": {
      const undo = /^restored (\d+)(?:, skipped (\d+))?$/.exec(first);
      if (!undo) return first === "nothing to undo" ? "Nothing to undo" : first;
      const restored = `Restored ${plural(Number(undo[1]), "file")}`;
      return undo[2] ? `${restored}, skipped ${undo[2]}` : restored;
    }
    default:
      return first;
  }
}
