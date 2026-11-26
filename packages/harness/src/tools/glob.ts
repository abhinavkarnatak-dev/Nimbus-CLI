import { realpath, stat } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import picomatch from "picomatch";
import { z } from "zod";
import { resolveInside, toDisplayPath } from "./paths.js";
import { ALWAYS_EXCLUDED, BASE_RIPGREP_ARGS, runRipgrep } from "./ripgrep.js";
import { defineTool } from "./types.js";

export const MAX_GLOB_RESULTS = 200;
const MAX_FILES_TO_SORT = 5000;

const schema = z.strictObject({
  pattern: z.string(),
  path: z.string().nullable(),
});

export const globTool = defineTool({
  name: "glob",
  description: `Find files by name pattern. Returns paths relative to the working directory,
newest first, up to 200 results.
- pattern: a glob such as "src/**/*.ts" or "**/package.json".
- path: folder to search in. Use null for the whole working directory.
- To match several names at once, use braces, for example
  "**/*.{test,spec}.{ts,js}" or "**/{tests,__tests__}/**".
Respects .gitignore and always ignores node_modules and .git. Use this to find
files, not to search inside them.`,
  schema,
  // List matching files, newest first
  async run({ pattern, path }, ctx) {
    const normalized = pattern.replaceAll("\\", "/");
    if (isAbsolute(normalized) || normalized.split("/").includes("..")) {
      throw new Error("pattern must stay inside the working directory (no absolute paths or ..)");
    }

    const root = await realpath(ctx.cwd);
    const base = path ? await resolveInside(ctx.cwd, path) : root;
    if (!(await stat(base)).isDirectory()) throw new Error(`${path} is not a directory`);
    const target = toDisplayPath(root, base);

    // Match ourselves: ripgrep --glob would override .gitignore
    const matches = picomatch(normalized, { dot: true });
    const prefix = target === "." ? "" : `${target}/`;
    const run = await runRipgrep(
      ["--files", ...BASE_RIPGREP_ARGS, ...ALWAYS_EXCLUDED, "--", target],
      root,
      ctx.signal,
      MAX_FILES_TO_SORT,
      (file) => file.startsWith(prefix) && matches(file.slice(prefix.length)),
    );
    if (run.code === 2 && run.lines.length === 0) {
      throw new Error(`file search failed: ${run.stderr.trim() || "unknown error"}`);
    }
    if (run.lines.length === 0) {
      return { output: `No files matched "${pattern}".`, summary: "0 files" };
    }

    const withTimes = await Promise.all(
      run.lines.map(async (file) => {
        const info = await stat(join(root, file)).catch(() => undefined);
        return { file, mtime: info?.mtimeMs ?? 0 };
      }),
    );
    const files = withTimes.sort((a, b) => b.mtime - a.mtime).map((entry) => entry.file);

    const shown = files.slice(0, MAX_GLOB_RESULTS);
    const total = run.more ? `more than ${files.length}` : String(files.length);
    const hidden = files.length - shown.length;
    const note = hidden > 0 || run.more ? `\n\n(${total} files matched, narrow the pattern)` : "";
    return {
      output: shown.join("\n") + note,
      summary: `${run.more ? `${files.length}+` : files.length} file${files.length === 1 ? "" : "s"}`,
    };
  },
});
