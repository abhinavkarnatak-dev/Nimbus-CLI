import { readFile, realpath, stat, writeFile } from "node:fs/promises";
import { z } from "zod";
import { resolveInside, toDisplayPath } from "./paths.js";
import { decodeText, describeChange, encodeText, isBinary, withEol } from "./text.js";
import { defineTool } from "./types.js";

const SNIPPET_CONTEXT = 3;

const schema = z.strictObject({
  path: z.string(),
  old_string: z.string(),
  new_string: z.string(),
  replace_all: z.boolean().nullable(),
});

function countOccurrences(text: string, search: string): number {
  let count = 0;
  for (let at = text.indexOf(search); at !== -1; at = text.indexOf(search, at + search.length)) {
    count++;
  }
  return count;
}

export function looksLikeLineNumbers(text: string): boolean {
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== "");
  return lines.length > 0 && lines.every((line) => /^\s*\d+\t/.test(line));
}

// Numbered lines around the edited spot
function snippet(text: string, eol: string, startIndex: number, newText: string): string {
  const lines = text.split(eol);
  const firstLine = text.slice(0, startIndex).split(eol).length;
  const lastLine = firstLine + newText.split(eol).length - 1;
  const from = Math.max(1, firstLine - SNIPPET_CONTEXT);
  const to = Math.min(lines.length, lastLine + SNIPPET_CONTEXT);
  return lines
    .slice(from - 1, to)
    .map((line, i) => `${String(from + i).padStart(6)}\t${line}`)
    .join("\n");
}

export const editTool = defineTool({
  name: "edit",
  description: `Replace exact text in a file. old_string must appear exactly once in the file,
or set replace_all to true to replace every occurrence. Matching is exact:
whitespace, indentation and line breaks must be the same as in the file.
The file must have been read in this session and not changed since.
- path: the file to edit.
- old_string: the text to replace, copied exactly from the file, without the
  line number prefixes that read_file adds.
- new_string: the replacement text.
- replace_all: true to replace every occurrence. Use null for false.`,
  schema,
  // Exact, unique text replacement
  async run({ path, old_string, new_string, replace_all }, ctx) {
    if (old_string === "") throw new Error("old_string is empty. Use write_file to create a file");
    if (old_string === new_string) throw new Error("old_string and new_string are the same");
    if (looksLikeLineNumbers(old_string)) {
      throw new Error(
        "old_string looks like it includes line number prefixes from read_file. Remove them and copy only the file text",
      );
    }

    const file = await resolveInside(ctx.cwd, path);
    const display = toDisplayPath(await realpath(ctx.cwd), file);
    if ((await stat(file)).isDirectory()) throw new Error(`${path} is a directory, not a file`);
    await ctx.files.assertFresh(file, display);

    const bytes = await readFile(file);
    if (isBinary(bytes)) throw new Error(`${path} is a binary file and cannot be edited`);
    const before = decodeText(bytes);

    const search = withEol(old_string, before.eol);
    const replacement = withEol(new_string, before.eol);
    const count = countOccurrences(before.text, search);
    if (count === 0) {
      throw new Error(
        `old_string was not found in ${display}. Read the file again; whitespace and indentation must match exactly`,
      );
    }
    if (count > 1 && !replace_all) {
      throw new Error(
        `old_string was found ${count} times in ${display}. Include more surrounding lines to make it unique, or set replace_all to true`,
      );
    }

    const firstIndex = before.text.indexOf(search);
    const text = replace_all
      ? before.text.split(search).join(replacement)
      : before.text.replace(search, () => replacement);
    const written = Buffer.from(encodeText({ ...before, text }));
    await writeFile(file, written);
    await ctx.files.markCurrent(file);
    ctx.changes?.record(file, display, bytes, written);

    const change = describeChange(display, before.text, text);
    const replaced = replace_all && count > 1 ? ` Replaced ${count} occurrences.` : "";
    return {
      output: `Edited ${display} (+${change.added} -${change.removed}).${replaced}\nResult around the change:\n${snippet(text, before.eol, firstIndex, replacement)}`,
      summary: `+${change.added} -${change.removed}`,
      diff: change.diff,
    };
  },
});
