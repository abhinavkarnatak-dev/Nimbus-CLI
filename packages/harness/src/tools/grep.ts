import { realpath } from "node:fs/promises";
import picomatch from "picomatch";
import { z } from "zod";
import { resolveInside, toDisplayPath } from "./paths.js";
import { ALWAYS_EXCLUDED, BASE_RIPGREP_ARGS, runRipgrep } from "./ripgrep.js";
import { defineTool } from "./types.js";

export const MAX_GREP_RESULTS = 200;

const schema = z.strictObject({
  pattern: z.string(),
  path: z.string().nullable(),
  glob: z.string().nullable(),
  case_insensitive: z.boolean().nullable(),
  output_mode: z.enum(["files", "content"]),
});

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

    const args = [...BASE_RIPGREP_ARGS, ...ALWAYS_EXCLUDED, "--sort=path", "--max-columns=500"];
    args.push("--max-columns-preview");
    if (case_insensitive) args.push("--ignore-case");
    args.push(
      ...(output_mode === "files"
        ? ["--files-with-matches"]
        : ["--line-number", "--with-filename", "--null"]),
    );
    args.push("-e", pattern, "--", target);

    // Filter ourselves: ripgrep --glob would override .gitignore
    const matches = glob ? picomatch(glob, { dot: true, basename: true }) : undefined;
    const pathOf = (line: string) => (output_mode === "files" ? line : (line.split("\0")[0] ?? ""));
    const run = await runRipgrep(args, root, ctx.signal, MAX_GREP_RESULTS, (line) =>
      matches ? matches(pathOf(line)) : true,
    );
    if (run.code === 2 && run.lines.length === 0) {
      throw new Error(`ripgrep failed: ${run.stderr.trim() || "unknown error"}`);
    }
    if (run.lines.length === 0) {
      return { output: `No matches for "${pattern}".`, summary: "0 matches" };
    }

    const note = run.more ? `\n\n(more than ${MAX_GREP_RESULTS} results, narrow the search)` : "";
    const count = `${run.lines.length}${run.more ? "+" : ""}`;
    const one = run.lines.length === 1 && !run.more;
    const unit = output_mode === "files" ? (one ? "file" : "files") : one ? "match" : "matches";
    const lines = run.lines.map((line) => line.replace("\0", ":"));
    return { output: lines.join("\n") + note, summary: `${count} ${unit}` };
  },
});
