import { mkdtemp, readFile, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { editTool, looksLikeLineNumbers } from "./edit.js";
import { FileTracker } from "./file-state.js";
import { readFileTool } from "./read-file.js";
import { writeFileTool } from "./write-file.js";

let root: string;
let files: FileTracker;
const ctx = () => ({ cwd: root, signal: new AbortController().signal, files });
const read = (path: string) =>
  readFileTool.execute(JSON.stringify({ path, offset: null, limit: null }), ctx());
const edit = (
  path: string,
  old_string: string,
  new_string: string,
  replace_all: boolean | null = null,
) => editTool.execute(JSON.stringify({ path, old_string, new_string, replace_all }), ctx());
const write = (path: string, content: string) =>
  writeFileTool.execute(JSON.stringify({ path, content }), ctx());
const contents = (path: string) => readFile(join(root, path), "utf8");

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "nimbus-edit-"));
  files = new FileTracker();
  await writeFile(join(root, "app.ts"), "const port = 3000;\nstart(port);\nstart(port);\n");
});

describe("edit", () => {
  it("replaces a unique string and returns a diff and snippet", async () => {
    await read("app.ts");
    const result = await edit("app.ts", "const port = 3000;", "const port = 8080;");

    expect(result.isError).toBeUndefined();
    expect(await contents("app.ts")).toBe("const port = 8080;\nstart(port);\nstart(port);\n");
    expect(result.summary).toBe("+1 -1");
    expect(result.output).toContain("     1\tconst port = 8080;");
    expect(result.diff).toContain("-const port = 3000;");
    expect(result.diff).toContain("+const port = 8080;");
  });

  it("refuses to edit a file that was not read", async () => {
    const result = await edit("app.ts", "3000", "8080");
    expect(result.output).toContain("read app.ts with read_file before changing it");
    expect(await contents("app.ts")).toContain("3000");
  });

  it("refuses to edit a file that changed after it was read", async () => {
    await read("app.ts");
    await writeFile(join(root, "app.ts"), "const port = 1234;\n");
    const later = new Date(Date.now() + 5000);
    await utimes(join(root, "app.ts"), later, later);

    const result = await edit("app.ts", "1234", "8080");
    expect(result.output).toContain("changed after you read it");
    expect(await contents("app.ts")).toBe("const port = 1234;\n");
  });

  it("refuses ambiguous matches unless replace_all is set", async () => {
    await read("app.ts");
    const ambiguous = await edit("app.ts", "start(port);", "run(port);");
    expect(ambiguous.output).toContain("found 2 times");

    const all = await edit("app.ts", "start(port);", "run(port);", true);
    expect(all.output).toContain("Replaced 2 occurrences");
    expect(await contents("app.ts")).toBe("const port = 3000;\nrun(port);\nrun(port);\n");
  });

  it("explains when old_string is not found", async () => {
    await read("app.ts");
    const result = await edit("app.ts", "const  port = 3000;", "x");
    expect(result.output).toContain("was not found");
  });

  it("rejects old_string copied with line numbers", async () => {
    await read("app.ts");
    const result = await edit("app.ts", "     1\tconst port = 3000;", "const port = 1;");
    expect(result.output).toContain("line number prefixes");
    expect(looksLikeLineNumbers("    12\tfoo\n    13\tbar")).toBe(true);
    expect(looksLikeLineNumbers("const a = 1;")).toBe(false);
  });

  it("keeps windows line endings and the BOM", async () => {
    await writeFile(join(root, "win.txt"), "﻿alpha\r\nbeta\r\n");
    await read("win.txt");
    await edit("win.txt", "alpha\nbeta", "alpha\ngamma");
    expect(await contents("win.txt")).toBe("﻿alpha\r\ngamma\r\n");
  });

  it("does not treat $ in new_string as a special pattern", async () => {
    await read("app.ts");
    await edit("app.ts", "const port = 3000;", "const price = `$&$1`;");
    expect(await contents("app.ts")).toContain("const price = `$&$1`;");
  });

  it("allows a second edit right after the first", async () => {
    await read("app.ts");
    await edit("app.ts", "3000", "8080");
    const second = await edit("app.ts", "8080", "9090");
    expect(second.isError).toBeUndefined();
  });

  it("refuses paths outside the working directory", async () => {
    expect((await edit("../x.ts", "a", "b")).output).toContain("outside the working directory");
  });
});

describe("write_file", () => {
  it("creates new files and folders without a prior read", async () => {
    const result = await write("src/new/util.ts", "export const a = 1;\n");
    expect(result.output).toBe("Created src/new/util.ts (1 lines).");
    expect(await contents("src/new/util.ts")).toBe("export const a = 1;\n");
  });

  it("refuses to replace an existing file that was not read", async () => {
    const result = await write("app.ts", "gone\n");
    expect(result.isError).toBe(true);
    expect(await contents("app.ts")).toContain("3000");
  });

  it("replaces a file after it was read, keeping its line endings", async () => {
    await writeFile(join(root, "win.txt"), "one\r\ntwo\r\n");
    await read("win.txt");
    const result = await write("win.txt", "one\nthree\n");
    expect(result.summary).toBe("+1 -1");
    expect(await contents("win.txt")).toBe("one\r\nthree\r\n");
  });

  it("refuses paths outside the working directory", async () => {
    expect((await write("../escape.ts", "x")).output).toContain("outside the working directory");
  });
});
