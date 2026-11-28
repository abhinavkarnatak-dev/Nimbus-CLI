import { readFile, stat } from "node:fs/promises";
import { z } from "zod";
import { isBinary } from "./text.js";
import { outsideFolder, readableDirs, resolveReadable } from "./paths.js";
import { assertNotSecret } from "./secrets.js";
import { MAX_TOOL_OUTPUT } from "./truncate.js";
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
Fails for binary files. A file outside the working directory can be read too: pass its
full path, and the user is asked first.`,
  schema,
  // Files outside the working folder need a yes
  askFirst: ({ path }, ctx) => outsideFolder(ctx, path),
  // Read numbered lines of a file
  async run({ path, offset, limit }, ctx) {
    const start = offset ?? 1;
    const count = limit ?? DEFAULT_READ_LINES;
    if (!Number.isInteger(start) || start < 1)
      throw new Error("offset must be a whole number >= 1");
    if (!Number.isInteger(count) || count < 1) throw new Error("limit must be a whole number >= 1");

    const { path: file } = await resolveReadable(ctx.cwd, path, readableDirs(ctx));
    assertNotSecret(file, path);
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

    // Stop at a whole line once the output is long enough
    const last = Math.min(start - 1 + count, lines.length);
    const shown: string[] = [];
    let size = 0;
    for (let n = start; n <= last; n++) {
      const row = `${String(n).padStart(6)}\t${clipLine(lines[n - 1]!)}`;
      if (shown.length > 0 && size + row.length + 1 > MAX_TOOL_OUTPUT) break;
      shown.push(row);
      size += row.length + 1;
    }
    const end = start + shown.length - 1;
    const body = shown.join("\n");

    const partial = start > 1 || end < lines.length;
    const total = lines.length.toLocaleString("en-US");
    const note =
      end < lines.length
        ? `\n\n[Showed lines ${start}-${end} of ${total} to keep this short. To read more, call read_file with offset ${end + 1}.]`
        : partial
          ? `\n\n(File has ${lines.length} lines. Showing ${start}-${end}.)`
          : "";
    const summary = partial
      ? `lines ${start}-${end} of ${lines.length}`
      : `${lines.length} line${lines.length === 1 ? "" : "s"}`;
    return { output: body + note, summary };
  },
});
