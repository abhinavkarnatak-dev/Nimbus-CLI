import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import { resolveForWrite, toDisplayPath } from "./paths.js";
import { assertNotSecret } from "./secrets.js";
import { decodeText, describeChange, encodeText, isBinary, withEol } from "./text.js";
import { defineTool } from "./types.js";

const schema = z.strictObject({
  path: z.string(),
  content: z.string(),
});

function linesLabel(text: string): string {
  const count = lineCount(text);
  return `${count} line${count === 1 ? "" : "s"}`;
}

function lineCount(text: string): number {
  if (text === "") return 0;
  return text.split(/\r?\n/).length - (/\r?\n$/.test(text) ? 1 : 0);
}

export const writeFileTool = defineTool({
  name: "write_file",
  needsApproval: true,
  description: `Create a new file, or replace an existing file completely. Creates missing
folders. To replace an existing file you must read it first in this session.
Prefer edit for small changes to existing files.
- path: the file to write.
- content: the full new content of the file.`,
  schema,
  // Create or fully replace a file
  async run({ path, content }, ctx) {
    const target = await resolveForWrite(ctx.cwd, path);
    const display = toDisplayPath(target.root, target.path);
    assertNotSecret(target.path, display);

    if (!target.exists) {
      await mkdir(dirname(target.path), { recursive: true });
      await writeFile(target.path, content);
      await ctx.files.markCurrent(target.path);
      ctx.changes?.record(target.path, display, null, Buffer.from(content));
      const change = describeChange(display, "", content);
      return {
        output: `Created ${display} (${linesLabel(content)}).`,
        summary: `created, ${linesLabel(content)}`,
        diff: change.diff,
      };
    }

    if ((await stat(target.path)).isDirectory()) throw new Error(`${path} is a directory`);
    await ctx.files.assertFresh(target.path, display);
    const bytes = await readFile(target.path);
    if (isBinary(bytes)) throw new Error(`${path} is a binary file and cannot be replaced as text`);

    const before = decodeText(bytes);
    const text = withEol(content, before.eol);
    const written = Buffer.from(encodeText({ ...before, text }));
    await writeFile(target.path, written);
    await ctx.files.markCurrent(target.path);
    ctx.changes?.record(target.path, display, bytes, written);

    const change = describeChange(display, before.text, text);
    return {
      output: `Replaced ${display} (+${change.added} -${change.removed}).`,
      summary: `+${change.added} -${change.removed}`,
      diff: change.diff,
    };
  },
});
