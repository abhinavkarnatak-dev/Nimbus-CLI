import { readFile, stat } from "node:fs/promises";
import { z } from "zod";
import { isBinary } from "./text.js";
import { resolveInside } from "./paths.js";
import { defineTool } from "./types.js";

export const DEFAULT_READ_LINES = 2000;
export const MAX_LINE_LENGTH = 2000;
const MAX_FILE_BYTES = 20 * 1024 * 1024;

const schema = z.strictObject({
  path: z.string(),
  offset: z.number().nullable(),
  limit: z.number().nullable(),
});

function splitLines(text: string): string[] {
  if (text.length === 0) return [];
  const lines = text.split(/\r?\n/);
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

function clipLine(line: string): string {
  return line.length > MAX_LINE_LENGTH
    ? `${line.slice(0, MAX_LINE_LENGTH)}... [line truncated]`
    : line;
}

export const readFileTool = defineTool({
  name: "read_file",
  description: `Read a text file from the working directory. Returns lines prefixed with line
numbers ("  42<TAB>code"). Reads up to 2000 lines by default.
- offset: first line to read (1-based). Use null to start at line 1.
- limit: number of lines to read. Use null for the default.
For large files, find the right line with grep first, then read around it.
Fails for binary files and for paths outside the working directory.`,
  schema,
  // Read numbered lines of a file
  async run({ path, offset, limit }, ctx) {
    const start = offset ?? 1;
    const count = limit ?? DEFAULT_READ_LINES;
    if (!Number.isInteger(start) || start < 1)
      throw new Error("offset must be a whole number >= 1");
    if (!Number.isInteger(count) || count < 1) throw new Error("limit must be a whole number >= 1");

    const file = await resolveInside(ctx.cwd, path);
    const info = await stat(file);
    if (info.isDirectory()) throw new Error(`${path} is a directory, not a file`);
    if (info.size > MAX_FILE_BYTES)
      throw new Error(`${path} is too large to read (${info.size} bytes)`);

    const bytes = await readFile(file, { signal: ctx.signal });
    if (isBinary(bytes)) throw new Error(`${path} is a binary file and cannot be read as text`);

    ctx.files.markRead(file, info.mtimeMs);
    const lines = splitLines(bytes.toString("utf8"));
    if (lines.length === 0) return { output: "(empty file)", summary: "empty file" };
    if (start > lines.length) {
      throw new Error(`offset ${start} is past the end of the file (${lines.length} lines)`);
    }

    const end = Math.min(start - 1 + count, lines.length);
    const body = lines
      .slice(start - 1, end)
      .map((line, i) => `${String(start + i).padStart(6)}\t${clipLine(line)}`)
      .join("\n");

    const partial = start > 1 || end < lines.length;
    const note = partial
      ? `\n\n(File has ${lines.length} lines. Showing ${start}-${end}. Use offset and limit to read more.)`
      : "";
    const summary = partial
      ? `lines ${start}-${end} of ${lines.length}`
      : `${lines.length} line${lines.length === 1 ? "" : "s"}`;
    return { output: body + note, summary };
  },
});
