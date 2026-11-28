import { isAbsolute, relative } from "node:path";
import { alwaysAskReason, type ApprovalRequest, type ApproveFn } from "@nimbus/harness";
import { shortenPath } from "./ui/format.js";
import type { PermissionMode, SettingsStore } from "./settings.js";

export const MODES: { mode: PermissionMode; label: string }[] = [
  { mode: "ask", label: "Ask before edits and commands" },
  { mode: "edits", label: "Edit files without asking, ask before commands" },
  { mode: "full", label: "Don't ask" },
];

// Shown in the status bar when not the default
export const MODE_BADGE: Record<PermissionMode, string | null> = {
  ask: null,
  edits: "auto edits",
  full: "don't ask",
};

const FILE_TOOLS = new Set(["edit", "write_file", "undo_changes"]);

export interface ApprovalPrompt {
  request: ApprovalRequest;
  // Yellow line for actions that always ask
  warning: string | null;
  // What "don't ask again" would cover; null hides that choice
  remember: string | null;
}

export type ApprovalChoice = "yes" | "always" | "no";

function isInside(root: string, target: string): boolean {
  const lower = (path: string) => (process.platform === "win32" ? path.toLowerCase() : path);
  const rel = relative(lower(root), lower(target));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

// "npm test" or "node"; null when the command chains others
export function commandKey(command: string): string | null {
  const text = command.trim();
  if (!text || /[;&|<>`\n]|\$\(/.test(text)) return null;
  const words = text.split(/\s+/);
  const plain = (word: string | undefined) => word !== undefined && !/^-|[/\\.:]/.test(word);
  if (!plain(words[1])) return words[0]!;
  const runner = ["run", "exec", "x"].includes(words[1]!);
  return runner && plain(words[2]) ? words.slice(0, 3).join(" ") : words.slice(0, 2).join(" ");
}

// Decides what runs on its own and what asks the user
export class Permissions {
  #mode: PermissionMode;
  #edits = false;
  readonly #commands = new Set<string>();
  // Outside folders the user said "don't ask again" for
  readonly #folders = new Set<string>();
  readonly #settings: SettingsStore;
  // Set by the UI; without it, anything that would ask is refused
  prompt: ((prompt: ApprovalPrompt, signal: AbortSignal) => Promise<ApprovalChoice>) | null = null;

  constructor(settings: SettingsStore) {
    this.#settings = settings;
    this.#mode = settings.load().permissions ?? "ask";
  }

  get mode(): PermissionMode {
    return this.#mode;
  }

  setMode(mode: PermissionMode): void {
    this.#mode = mode;
    this.#settings.save({ ...this.#settings.load(), permissions: mode });
  }

  // "Don't ask again" lasts one session
  resetSession(): void {
    this.#edits = false;
    this.#commands.clear();
    this.#folders.clear();
  }

  approve: ApproveFn = async (request, signal) => {
    if (request.folder) return this.#approveRead(request, request.folder, signal);
    const isFile = FILE_TOOLS.has(request.tool);
    const command = request.tool === "bash" ? String(request.args.command ?? "") : "";
    const key = request.tool === "bash" ? commandKey(command) : null;
    const warning = request.tool === "bash" ? alwaysAskReason(command) : null;
    if (!warning) {
      if (this.#mode === "full") return "allow";
      if (isFile && (this.#mode === "edits" || this.#edits)) return "allow";
      if (key && this.#commands.has(key)) return "allow";
    }
    if (!this.prompt) return "deny";
    const remember = warning ? null : isFile ? "file edits" : key ? `"${key}"` : null;
    const choice = await this.prompt({ request, warning, remember }, signal);
    if (choice === "always") {
      if (isFile) this.#edits = true;
      else if (key) this.#commands.add(key);
    }
    return choice === "no" ? "deny" : "allow";
  };

  // Reading outside the working folder; no mode but "don't ask" skips it
  async #approveRead(
    request: ApprovalRequest,
    folder: string,
    signal: AbortSignal,
  ): Promise<"allow" | "deny"> {
    if (this.#mode === "full") return "allow";
    if ([...this.#folders].some((allowed) => isInside(allowed, folder))) return "allow";
    if (!this.prompt) return "deny";
    const choice = await this.prompt(
      { request, warning: null, remember: `files in ${shortenPath(folder)}` },
      signal,
    );
    if (choice === "always") this.#folders.add(folder);
    return choice === "no" ? "deny" : "allow";
  }
}
