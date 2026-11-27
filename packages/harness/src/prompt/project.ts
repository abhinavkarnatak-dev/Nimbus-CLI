import { readFileSync } from "node:fs";
import { join } from "node:path";

// Bigger files are cut so one file cannot fill the context
export const MAX_DOC_CHARS = 20_000;

export interface ProjectDoc {
  // Shown to the model, for example "AGENTS.md" or "~/.nimbus/AGENTS.md"
  label: string;
  content: string;
}

export interface Memories {
  user: string[];
  project: string[];
}

function readDoc(path: string, label: string): ProjectDoc | null {
  try {
    const text = readFileSync(path, "utf8").trim();
    if (!text) return null;
    const content =
      text.length > MAX_DOC_CHARS
        ? `${text.slice(0, MAX_DOC_CHARS)}\n\n[The rest of this file was cut because it is longer than ${MAX_DOC_CHARS.toLocaleString("en-US")} characters.]`
        : text;
    return { label, content };
  } catch {
    return null;
  }
}

// The user's own AGENTS.md, then the project's (or CLAUDE.md)
export function loadProjectDocs(cwd: string, home: string): ProjectDoc[] {
  const docs: ProjectDoc[] = [];
  const personal = readDoc(join(home, ".nimbus", "AGENTS.md"), "~/.nimbus/AGENTS.md");
  if (personal) docs.push(personal);
  const project =
    readDoc(join(cwd, "AGENTS.md"), "AGENTS.md") ?? readDoc(join(cwd, "CLAUDE.md"), "CLAUDE.md");
  if (project) docs.push(project);
  return docs;
}

// Seen by the model: instructions from files
export function docsSection(docs: readonly ProjectDoc[]): string {
  return docs
    .map((doc) => {
      const from =
        doc.label === "~/.nimbus/AGENTS.md"
          ? "the user's personal ~/.nimbus/AGENTS.md, which applies to every project"
          : `${doc.label} in the user's project`;
      return `

Project instructions:
The following comes from ${from}. Follow it like instructions from the user, unless the
user says otherwise in this conversation.

${doc.content}`;
    })
    .join("");
}

// Seen by the model: facts saved in earlier sessions
export function memorySection(memories: Memories | undefined): string {
  if (!memories || (memories.user.length === 0 && memories.project.length === 0)) return "";
  const list = (facts: string[]) => facts.map((fact) => `- ${fact}`).join("\n");
  const parts = [
    memories.user.length ? `About the user:\n${list(memories.user)}` : "",
    memories.project.length ? `About this project:\n${list(memories.project)}` : "",
  ].filter(Boolean);
  return `

Memory:
Facts you saved in earlier conversations with this user. Use them where they help. They
may be out of date, and the user's messages in this conversation win if they disagree.

${parts.join("\n")}`;
}
