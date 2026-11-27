// Seen by the model: changed code but ran nothing after
export const VERIFY_REMINDER =
  "[You changed code in this reply but did not run anything after the last change. If the project has tests, a build or a way to run what you changed, run it now and fix what fails. If the user asked you not to run anything, do not run anything: just finish. If there is nothing to run, say so in one line and finish.]";

// Added to a result the model keeps asking for
export const REPEAT_NOTE =
  "[You have made this exact call 3 times in this reply and got the same result. Do not repeat it. Try a different approach, or tell the user what is blocking you and ask how to continue.]";

export const SAME_ERROR_NOTE =
  "[This failed 3 times in a row with the same error. Stop and rethink: read the file or output again to see what is really there, try a different approach, or ask the user.]";

export const WARN_AT = 3;
export const STOP_AT = 5;

// Files that can usually be run, built or tested
const CODE_EXTENSIONS = new Set([
  "js",
  "jsx",
  "mjs",
  "cjs",
  "ts",
  "tsx",
  "mts",
  "cts",
  "py",
  "go",
  "rs",
  "java",
  "kt",
  "kts",
  "scala",
  "c",
  "cc",
  "cpp",
  "h",
  "hpp",
  "cs",
  "rb",
  "php",
  "swift",
  "dart",
  "lua",
  "ex",
  "exs",
  "sh",
  "bash",
  "ps1",
  "vue",
  "svelte",
]);

export function isCodePath(path: string): boolean {
  const ext = /\.([a-z0-9]+)$/i.exec(path)?.[1]?.toLowerCase();
  return ext !== undefined && CODE_EXTENSIONS.has(ext);
}

// What one turn has seen, to spot loops and unchecked changes
export class TurnChecks {
  #step = 0;
  #changedAt = -1;
  #ranAt = -1;
  reminded = false;
  readonly #calls = new Map<string, { output: string; count: number }>();
  #lastError: string | null = null;
  #errorRun = 0;

  // Count a finished call; returns the note to add, and whether to stop
  record(
    name: string,
    args: string,
    output: string,
    isError: boolean,
  ): { note: string | null; stop: boolean } {
    this.#step++;
    if (name === "bash" || name === "bash_output") this.#ranAt = this.#step;
    if ((name === "edit" || name === "write_file") && !isError) {
      const path = (() => {
        try {
          return String((JSON.parse(args) as { path?: unknown }).path ?? "");
        } catch {
          return "";
        }
      })();
      if (isCodePath(path)) this.#changedAt = this.#step;
    }

    const key = `${name}\0${args}`;
    const seen = this.#calls.get(key);
    const repeats = seen && seen.output === output ? seen.count + 1 : 1;
    this.#calls.set(key, { output, count: repeats });

    this.#errorRun = isError && output === this.#lastError ? this.#errorRun + 1 : isError ? 1 : 0;
    this.#lastError = isError ? output : null;

    const note =
      repeats >= WARN_AT ? REPEAT_NOTE : this.#errorRun >= WARN_AT ? SAME_ERROR_NOTE : null;
    return { note, stop: repeats >= STOP_AT || this.#errorRun >= STOP_AT };
  }

  // Code changed and nothing ran after it
  get needsCheck(): boolean {
    return !this.reminded && this.#changedAt > this.#ranAt;
  }
}
