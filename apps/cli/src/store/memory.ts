import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { MemoryBook, MemoryScope, Memories } from "@nimbus/harness";

export const MAX_FACTS = 100;
const HEADER = "# Nimbus memory\n\n";

// One folder per project, outside the project itself
export function projectMemoryPath(dataDir: string, cwd: string): string {
  const key = process.platform === "win32" ? cwd.toLowerCase() : cwd;
  const hash = createHash("sha256").update(key).digest("hex").slice(0, 16);
  return join(dataDir, "projects", hash, "memory.md");
}

function readFacts(path: string): string[] {
  try {
    return readFileSync(path, "utf8")
      .split(/\r?\n/)
      .filter((line) => line.startsWith("- "))
      .map((line) => line.slice(2).trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function writeFacts(path: string, facts: string[]): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(
    path,
    HEADER + facts.map((fact) => `- ${fact}`).join("\n") + (facts.length ? "\n" : ""),
  );
}

// Facts the model saved, in two small markdown files
export class FileMemory implements MemoryBook {
  constructor(
    readonly userPath: string,
    readonly projectPath: string,
    readonly projectFolder: string,
  ) {}

  list(): Memories {
    return { user: readFacts(this.userPath), project: readFacts(this.projectPath) };
  }

  save(fact: string, scope: MemoryScope): "saved" | "duplicate" | "full" {
    const path = scope === "user" ? this.userPath : this.projectPath;
    const facts = readFacts(path);
    if (facts.some((saved) => saved.toLowerCase() === fact.toLowerCase())) return "duplicate";
    if (facts.length >= MAX_FACTS) return "full";
    writeFacts(path, [...facts, fact.replace(/\s+/g, " ")]);
    // Lets a person find which project a folder belongs to
    if (scope === "project") writeFileSync(join(dirname(path), "folder.txt"), this.projectFolder);
    return "saved";
  }

  // Number from /memory: user facts first, then project facts
  forget(number: number): string | null {
    const { user, project } = this.list();
    if (!Number.isInteger(number) || number < 1 || number > user.length + project.length)
      return null;
    if (number <= user.length) {
      const [removed] = user.splice(number - 1, 1);
      writeFacts(this.userPath, user);
      return removed!;
    }
    const [removed] = project.splice(number - 1 - user.length, 1);
    writeFacts(this.projectPath, project);
    return removed!;
  }
}

// What /memory shows
export function memoryReport(memories: Memories): string[] {
  if (memories.user.length + memories.project.length === 0) {
    return [
      'Nothing saved yet. Ask Nimbus to remember something, for example "remember that I use pnpm".',
    ];
  }
  const lines: string[] = [];
  let n = 0;
  if (memories.user.length) {
    lines.push("About you");
    for (const fact of memories.user) lines.push(`  ${++n}. ${fact}`);
  }
  if (memories.project.length) {
    lines.push("About this project");
    for (const fact of memories.project) lines.push(`  ${++n}. ${fact}`);
  }
  lines.push("", "Remove one with /memory forget <number>. New facts apply from the next session.");
  return lines;
}
