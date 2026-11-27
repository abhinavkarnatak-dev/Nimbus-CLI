import { mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { diffArrays } from "diff";
import { decodeText, encodeText, isBinary, withEol } from "./text.js";

// Bigger files are not copied, so they cannot be undone
export const MAX_SNAPSHOT_BYTES = 2 * 1024 * 1024;

// One file in one reply: before the first write, after the last
export interface FileChange {
  turn: number;
  turnTitle: string;
  path: string;
  display: string;
  // null: the file did not exist
  before: Buffer | null;
  after: Buffer | null;
  tooBig: boolean;
}

export interface UndoRequest {
  replies: number;
  paths: string[] | null;
  restoreTo: "before" | "as_left";
  overwriteUserEdits: boolean;
}

export interface UndoFileResult {
  display: string;
  outcome:
    "restored" | "merged" | "deleted" | "as_left" | "overwritten" | "conflict" | "gone" | "too_big";
}

export interface UndoResult {
  titles: string[];
  files: UndoFileResult[];
  ranCommands: boolean;
}

const keyOf = (path: string) => (process.platform === "win32" ? path.toLowerCase() : path);
const same = (a: Buffer | null, b: Buffer | null) =>
  a === null || b === null ? a === b : a.equals(b);
const tooBig = (bytes: Buffer | null) => (bytes?.length ?? 0) > MAX_SNAPSHOT_BYTES;

async function readIfExists(path: string): Promise<Buffer | null> {
  try {
    return await readFile(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

// A run of changed lines, as a range of the base file
interface Hunk {
  start: number;
  end: number;
  lines: string[];
}

function hunksOf(base: string[], other: string[]): Hunk[] {
  const hunks: Hunk[] = [];
  let pos = 0;
  let current: Hunk | null = null;
  for (const part of diffArrays(base, other)) {
    if (!part.added && !part.removed) {
      if (current) hunks.push(current);
      current = null;
      pos += part.value.length;
      continue;
    }
    current ??= { start: pos, end: pos, lines: [] };
    if (part.removed) {
      pos += part.value.length;
      current.end = pos;
    } else {
      current.lines.push(...part.value);
    }
  }
  if (current) hunks.push(current);
  return hunks;
}

// Both sides changed the same lines
function clash(a: Hunk, b: Hunk): boolean {
  const aInsert = a.start === a.end;
  const bInsert = b.start === b.end;
  if (aInsert && bInsert) return a.start === b.start;
  if (aInsert) return b.start < a.start && a.start < b.end;
  if (bInsert) return a.start < b.start && b.start < a.end;
  return a.start < b.end && b.start < a.end;
}

// Three-way merge: undo our lines, keep the user's
export function mergeLines(base: string[], undo: string[], user: string[]): string[] | null {
  const ours = hunksOf(base, undo);
  const theirs = hunksOf(base, user);
  if (ours.some((a) => theirs.some((b) => clash(a, b)))) return null;
  const all = [...ours, ...theirs].sort(
    (a, b) => a.start - b.start || a.end - a.start - (b.end - b.start),
  );
  const out: string[] = [];
  let pos = 0;
  for (const hunk of all) {
    out.push(...base.slice(pos, hunk.start), ...hunk.lines);
    pos = hunk.end;
  }
  out.push(...base.slice(pos));
  return out;
}

function mergeBack(current: Buffer, ours: Buffer, original: Buffer): Buffer | null {
  if (isBinary(current) || isBinary(ours) || isBinary(original)) return null;
  const now = decodeText(current);
  const lines = (bytes: Buffer) => withEol(decodeText(bytes).text, "\n").split("\n");
  const merged = mergeLines(lines(ours), lines(original), lines(current));
  if (!merged) return null;
  return Buffer.from(encodeText({ ...now, text: withEol(merged.join("\n"), now.eol) }));
}

// Every file edit and write_file made, per reply
export class ChangeLog {
  readonly #changes = new Map<string, FileChange>();
  readonly #commandTurns = new Set<number>();
  // Turn each skipped file was first reported in
  readonly #conflicts = new Map<string, number>();
  readonly #onChange: (change: FileChange) => void;
  #turn = 0;
  #title = "";

  constructor(onChange: (change: FileChange) => void = () => {}, saved: FileChange[] = []) {
    this.#onChange = onChange;
    for (const change of saved) this.#changes.set(`${change.turn}:${keyOf(change.path)}`, change);
  }

  begin(turn: number, title: string): void {
    this.#turn = turn;
    this.#title = title.trim().slice(0, 80);
  }

  noteCommand(turn = this.#turn): void {
    this.#commandTurns.add(turn);
  }

  get changes(): FileChange[] {
    return [...this.#changes.values()];
  }

  // Called by tools right after they write
  record(path: string, display: string, before: Buffer | null, after: Buffer | null): void {
    const key = `${this.#turn}:${keyOf(path)}`;
    const earlier = this.#changes.get(key);
    const change: FileChange = earlier
      ? { ...earlier, after }
      : { turn: this.#turn, turnTitle: this.#title, path, display, before, after, tooBig: false };
    if (change.tooBig || tooBig(change.before) || tooBig(change.after)) {
      Object.assign(change, { before: null, after: null, tooBig: true });
    }
    this.#changes.set(key, change);
    this.#onChange(change);
  }

  // Put files back from the latest replies that changed them
  async undo(request: UndoRequest, cwd: string): Promise<UndoResult> {
    const root = await realpath(cwd);
    const wanted = request.paths?.map((path) =>
      keyOf(isAbsolute(path) ? path : resolve(root, path)),
    );
    const wantedDisplay = request.paths?.map((path) => keyOf(path.replace(/\\/g, "/")));
    const matches = (change: FileChange) =>
      !wanted ||
      wanted.includes(keyOf(change.path)) ||
      wantedDisplay!.includes(keyOf(change.display));

    // With paths, count only the replies that changed those files
    const candidates = this.changes.filter((c) => c.turn !== this.#turn && matches(c));
    const turns = [...new Set(candidates.map((change) => change.turn))]
      .sort((a, b) => b - a)
      .slice(0, Math.max(1, request.replies));

    // Oldest before and newest after, per file
    const files = new Map<string, { newest: FileChange; oldest: FileChange }>();
    for (const change of candidates.filter((c) => turns.includes(c.turn))) {
      const key = keyOf(change.path);
      const entry = files.get(key);
      if (!entry) files.set(key, { newest: change, oldest: change });
      else {
        if (change.turn > entry.newest.turn) entry.newest = change;
        if (change.turn < entry.oldest.turn) entry.oldest = change;
      }
    }

    const titles = turns.map(
      (turn) => this.changes.find((change) => change.turn === turn)?.turnTitle ?? "",
    );
    const results: UndoFileResult[] = [];
    for (const { newest, oldest } of files.values()) {
      results.push({
        display: newest.display,
        outcome: await this.#undoFile(newest, oldest, request),
      });
    }
    return {
      titles,
      files: results.sort((a, b) => a.display.localeCompare(b.display)),
      ranCommands: turns.some((turn) => this.#commandTurns.has(turn)),
    };
  }

  async #undoFile(
    newest: FileChange,
    oldest: FileChange,
    request: UndoRequest,
  ): Promise<UndoFileResult["outcome"]> {
    if (newest.tooBig || oldest.tooBig) return "too_big";
    const current = await readIfExists(newest.path);
    let target: Buffer | null;
    let outcome: UndoFileResult["outcome"];

    const merged =
      current && newest.after && oldest.before
        ? mergeBack(current, newest.after, oldest.before)
        : null;

    if (request.restoreTo === "as_left") {
      target = newest.after;
      outcome = "as_left";
    } else if (same(current, newest.after)) {
      target = oldest.before;
      outcome = target === null ? "deleted" : "restored";
    } else if (merged) {
      target = merged;
      outcome = "merged";
    } else if (request.overwriteUserEdits && this.#askedBefore(newest.path)) {
      target = oldest.before;
      outcome = "overwritten";
    } else {
      // Overwriting needs the user's answer, so never in the same reply
      const key = keyOf(newest.path);
      if (!this.#conflicts.has(key)) this.#conflicts.set(key, this.#turn);
      return current === null ? "gone" : "conflict";
    }

    if (same(current, target)) return outcome;
    if (target === null) await rm(newest.path, { force: true });
    else {
      await mkdir(dirname(newest.path), { recursive: true });
      await writeFile(newest.path, target);
    }
    // The undo is a change too, so it can be undone
    this.record(newest.path, newest.display, current, target);
    this.#conflicts.delete(keyOf(newest.path));
    return outcome;
  }

  #askedBefore(path: string): boolean {
    const turn = this.#conflicts.get(keyOf(path));
    return turn !== undefined && turn < this.#turn;
  }
}
