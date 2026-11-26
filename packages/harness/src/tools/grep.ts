import { realpath } from "node:fs/promises";
import picomatch from "picomatch";
import { z } from "zod";
import { resolveInside, toDisplayPath } from "./paths.js";
import { ALWAYS_EXCLUDED, BASE_RIPGREP_ARGS, runRipgrep } from "./ripgrep.js";
import { defineTool } from "./types.js";

export const MAX_GREP_RESULTS = 200;
const MAX_FOLDERS_SHOWN = 8;
const MAX_FILES_TO_COUNT = 100_000;

const schema = z.strictObject({
  pattern: z.string(),
  path: z.string().nullable(),
  glob: z.string().nullable(),
  case_insensitive: z.boolean().nullable(),
  output_mode: z.enum(["files", "content"]),
});

interface Overflow {
  total: number;
  files: number;
  folders: Array<[string, number]>;
}

function folderOf(file: string): string {
  const parts = file.split("/");
  parts.pop();
  return parts.length === 0 ? "(root)" : parts.slice(0, 2).join("/");
}

// Count all results per folder
async function countOverflow(
  args: string[],
  root: string,
  signal: AbortSignal,
  accept: (file: string) => boolean,
  countMatches: boolean,
): Promise<Overflow> {
  const run = await runRipgrep(args, root, signal, MAX_FILES_TO_COUNT, (line) =>
    accept(line.split("\0")[0] ?? ""),
  );

  const byFolder = new Map<string, number>();
  let total = 0;
  for (const line of run.lines) {
    const [file = "", count = "1"] = line.split("\0");
    const n = countMatches ? Number(count) || 0 : 1;
    total += n;
    byFolder.set(folderOf(file), (byFolder.get(folderOf(file)) ?? 0) + n);
  }
  const folders = [...byFolder.entries()].sort((a, b) => b[1] - a[1]);
  return { total, files: run.lines.length, folders };
}

function overflowNote(overflow: Overflow, shown: number, unit: string): string {
  const top = overflow.folders.slice(0, MAX_FOLDERS_SHOWN);
  const rest = overflow.folders.slice(MAX_FOLDERS_SHOWN).reduce((sum, [, n]) => sum + n, 0);
  const width = Math.max(...top.map(([folder]) => folder.length));
  const rows = top.map(([folder, n]) => `  ${folder.padEnd(width)}  ${n}`);
  if (rest > 0) rows.push(`  ${"(other folders)".padEnd(width)}  ${rest}`);

  const where = unit === "matches" ? ` in ${overflow.files} files` : "";
  return `\n\n(Showing the first ${shown} of ${overflow.total} ${unit}${where}, sorted by path.
${unit === "matches" ? "Matches" : "Files"} by folder:
${rows.join("\n")}
Narrow the search with path or glob.)`;
}

export const grepTool = defineTool({
  name: "grep",
  description: `Search inside files with a regular expression (ripgrep syntax). Respects
.gitignore. Returns up to 200 results.
- pattern: the regex, for example "function \\w+Session" or "TODO".
- path: file or folder to search. Use null for the whole working directory.
- glob: only search files matching this, for example "*.ts". Use null for all.
- case_insensitive: true to ignore case. Use null for false.
- output_mode: "files" lists matching file paths (use this first to see where
  something is), "content" shows matching lines with line numbers.`,
  schema,
  // Search file contents with ripgrep
  async run({ pattern, path, glob, case_insensitive, output_mode }, ctx) {
    const root = await realpath(ctx.cwd);
    const target = path ? toDisplayPath(root, await resolveInside(ctx.cwd, path)) : ".";

    const common = [...BASE_RIPGREP_ARGS, ...ALWAYS_EXCLUDED];
    if (case_insensitive) common.push("--ignore-case");
    const query = ["-e", pattern, "--", target];
    const modeArgs =
      output_mode === "files"
        ? ["--files-with-matches"]
        : ["--line-number", "--with-filename", "--null"];

    // Filter ourselves: ripgrep --glob would override .gitignore
    const matches = glob ? picomatch(glob, { dot: true, basename: true }) : undefined;
    const accept = (file: string) => (matches ? matches(file) : true);
    const pathOf = (line: string) => (output_mode === "files" ? line : (line.split("\0")[0] ?? ""));

    const run = await runRipgrep(
      [
        ...common,
        "--sort=path",
        "--max-columns=500",
        "--max-columns-preview",
        ...modeArgs,
        ...query,
      ],
      root,
      ctx.signal,
      MAX_GREP_RESULTS,
      (line) => accept(pathOf(line)),
    );
    if (run.code === 2 && run.lines.length === 0) {
      throw new Error(`ripgrep failed: ${run.stderr.trim() || "unknown error"}`);
    }
    if (run.lines.length === 0) {
      return { output: `No matches for "${pattern}".`, summary: "0 matches" };
    }

    const lines = run.lines.map((line) => line.replace("\0", ":"));
    const unit = output_mode === "files" ? "files" : "matches";
    if (!run.more) {
      const one = lines.length === 1;
      const label = output_mode === "files" ? (one ? "file" : "files") : one ? "match" : "matches";
      return { output: lines.join("\n"), summary: `${lines.length} ${label}` };
    }

    const countMatches = output_mode === "content";
    const overflow = await countOverflow(
      [
        ...common,
        ...(countMatches ? ["--count-matches", "--null"] : ["--files-with-matches"]),
        ...query,
      ],
      root,
      ctx.signal,
      accept,
      countMatches,
    );
    return {
      output: lines.join("\n") + overflowNote(overflow, lines.length, unit),
      summary: `${lines.length} of ${overflow.total} ${unit}`,
    };
  },
});
