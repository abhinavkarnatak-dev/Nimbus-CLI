import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { readFileTool } from "./read-file.js";

let root: string;
const ctx = () => ({ cwd: root, signal: new AbortController().signal });
const read = (args: object) => readFileTool.execute(JSON.stringify(args), ctx());
const args = (path: string, offset: number | null = null, limit: number | null = null) => ({
  path,
  offset,
  limit,
});

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "nimbus-read-"));
  await mkdir(join(root, "src"));
  await writeFile(join(root, "src", "a.ts"), "one\ntwo\nthree\n");
  await writeFile(join(root, "crlf.txt"), "first\r\nsecond\r\n");
  await writeFile(
    join(root, "big.txt"),
    Array.from({ length: 2500 }, (_, i) => `line ${i + 1}`).join("\n"),
  );
  await writeFile(join(root, "long.txt"), "x".repeat(3000));
  await writeFile(join(root, "empty.txt"), "");
  await writeFile(join(root, "image.bin"), Buffer.from([0x89, 0x50, 0x00, 0x01]));
});

describe("read_file", () => {
  it("returns numbered lines", async () => {
    const result = await read(args("src/a.ts"));
    expect(result.output).toBe("     1\tone\n     2\ttwo\n     3\tthree");
    expect(result.summary).toBe("3 lines");
  });

  it("handles windows line endings", async () => {
    const result = await read(args("crlf.txt"));
    expect(result.output).toBe("     1\tfirst\n     2\tsecond");
  });

  it("reads a range with offset and limit", async () => {
    const result = await read(args("src/a.ts", 2, 1));
    expect(result.output).toContain("     2\ttwo");
    expect(result.output).not.toContain("three");
    expect(result.output).toContain("File has 3 lines. Showing 2-2.");
  });

  it("caps large files at 2000 lines with a note", async () => {
    const result = await read(args("big.txt"));
    expect(result.output).toContain("  2000\tline 2000");
    expect(result.output).not.toContain("line 2001");
    expect(result.output).toContain("File has 2500 lines. Showing 1-2000.");
  });

  it("clips very long lines", async () => {
    const result = await read(args("long.txt"));
    expect(result.output).toContain("[line truncated]");
    expect(result.output.length).toBeLessThan(2100);
  });

  it("reports empty files", async () => {
    expect((await read(args("empty.txt"))).output).toBe("(empty file)");
  });

  it("refuses binary files", async () => {
    const result = await read(args("image.bin"));
    expect(result.isError).toBe(true);
    expect(result.output).toContain("binary file");
  });

  it("refuses paths outside the working directory", async () => {
    const result = await read(args("../outside.txt"));
    expect(result.isError).toBe(true);
    expect(result.output).toContain("outside the working directory");
  });

  it("reports missing files and directories", async () => {
    expect((await read(args("nope.ts"))).output).toContain("file not found");
    expect((await read(args("src"))).output).toContain("is a directory");
  });

  it("rejects bad offsets", async () => {
    expect((await read(args("src/a.ts", 0))).output).toContain("offset must be");
    expect((await read(args("src/a.ts", 10))).output).toContain("past the end");
  });
});
