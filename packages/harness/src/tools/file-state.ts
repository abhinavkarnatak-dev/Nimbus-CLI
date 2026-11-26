import { stat } from "node:fs/promises";

function keyOf(path: string): string {
  return process.platform === "win32" ? path.toLowerCase() : path;
}

// Remembers which files were read, and when
export class FileTracker {
  readonly #reads = new Map<string, number>();

  markRead(path: string, mtimeMs: number): void {
    this.#reads.set(keyOf(path), mtimeMs);
  }

  async markCurrent(path: string): Promise<void> {
    this.markRead(path, (await stat(path)).mtimeMs);
  }

  // Refuse blind or stale edits
  async assertFresh(path: string, displayPath: string): Promise<void> {
    const seen = this.#reads.get(keyOf(path));
    if (seen === undefined) {
      throw new Error(`read ${displayPath} with read_file before changing it`);
    }
    if ((await stat(path)).mtimeMs !== seen) {
      throw new Error(`${displayPath} changed after you read it. Read it again before changing it`);
    }
  }
}
