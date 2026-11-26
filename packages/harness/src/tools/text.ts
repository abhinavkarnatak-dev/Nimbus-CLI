import { structuredPatch } from "diff";

const BOM = "﻿";

export function isBinary(bytes: Buffer): boolean {
  return bytes.subarray(0, 8000).includes(0);
}

export interface TextFile {
  text: string;
  bom: boolean;
  eol: "\n" | "\r\n";
}

export function decodeText(bytes: Buffer): TextFile {
  let text = bytes.toString("utf8");
  const bom = text.startsWith(BOM);
  if (bom) text = text.slice(1);
  return { text, bom, eol: text.includes("\r\n") ? "\r\n" : "\n" };
}

export function encodeText(file: TextFile): string {
  return (file.bom ? BOM : "") + file.text;
}

export function withEol(text: string, eol: "\n" | "\r\n"): string {
  const lf = text.replace(/\r\n/g, "\n");
  return eol === "\r\n" ? lf.replace(/\n/g, "\r\n") : lf;
}

export interface Change {
  diff: string;
  added: number;
  removed: number;
}

// Unified diff plus line counts
export function describeChange(displayPath: string, before: string, after: string): Change {
  const patch = structuredPatch(
    displayPath,
    displayPath,
    withEol(before, "\n"),
    withEol(after, "\n"),
    "",
    "",
    { context: 3 },
  );
  let added = 0;
  let removed = 0;
  const lines = [`--- ${displayPath}`, `+++ ${displayPath}`];
  for (const hunk of patch.hunks) {
    lines.push(`@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`);
    for (const line of hunk.lines) {
      if (line.startsWith("+")) added++;
      else if (line.startsWith("-")) removed++;
      lines.push(line);
    }
  }
  return { diff: lines.join("\n"), added, removed };
}
