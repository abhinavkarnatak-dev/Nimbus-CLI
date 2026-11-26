import { mkdir, mkdtemp, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { FileTracker } from "./file-state.js";
import { globTool } from "./glob.js";
import { grepTool } from "./grep.js";

let root: string;
const ctx = () => ({ cwd: root, signal: new AbortController().signal, files: new FileTracker() });
const glob = (pattern: string, path: string | null = null) =>
  globTool.execute(JSON.stringify({ pattern, path }), ctx());
const grep = (pattern: string, options: Record<string, unknown> = {}) =>
  grepTool.execute(
    JSON.stringify({
      pattern,
      path: null,
      glob: null,
      case_insensitive: null,
      output_mode: "content",
      ...options,
    }),
    ctx(),
  );

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "nimbus-search-"));
  await mkdir(join(root, "src", "agent"), { recursive: true });
  await mkdir(join(root, "node_modules", "lib"), { recursive: true });
  await mkdir(join(root, ".github"));
  await writeFile(
    join(root, "src", "agent", "session.ts"),
    "export class Session {\n  abort() {}\n}\n",
  );
  await writeFile(join(root, "src", "cost.ts"), "export const PRICE = 1;\n// TODO: luna\n");
  await writeFile(join(root, "README.md"), "Nimbus session docs\n");
  await mkdir(join(root, "big", "inner"), { recursive: true });
  await mkdir(join(root, "tests"));
  await writeFile(join(root, "big", "inner", "a.ts"), "FIXME\n".repeat(150));
  await writeFile(join(root, "big", "b.ts"), "FIXME\n".repeat(100));
  await writeFile(join(root, "tests", "c.ts"), "FIXME\n".repeat(10));
  await mkdir(join(root, "many"));
  await Promise.all(
    Array.from({ length: 205 }, (_, i) => writeFile(join(root, "many", `f${i}.txt`), "NEEDLE\n")),
  );
  await writeFile(join(root, "node_modules", "lib", "index.ts"), "export class Session {}\n");
  await writeFile(join(root, ".github", "ci.yml"), "name: CI session\n");
  await writeFile(join(root, ".gitignore"), "ignored.ts\n.turbo/\n");
  await mkdir(join(root, ".turbo"));
  await writeFile(join(root, ".turbo", "turbo-test.log"), "test log\n");
  await writeFile(join(root, "ignored.ts"), "export class Session {}\n");

  const old = new Date("2020-01-01");
  await utimes(join(root, "src", "cost.ts"), old, old);
});

describe("glob", () => {
  it("finds files by pattern, newest first, without node_modules", async () => {
    const result = await glob("**/*.ts");
    const files = result.output.split("\n");
    expect(files).toContain("src/agent/session.ts");
    expect(files.at(-1)).toBe("src/cost.ts");
    expect(result.output).not.toContain("node_modules");
    expect(result.summary).toBe(`${files.length} files`);
  });

  it("searches inside a folder", async () => {
    const result = await glob("*.ts", "src/agent");
    expect(result.output).toBe("src/agent/session.ts");
    expect(result.summary).toBe("1 file");
  });

  it("respects .gitignore", async () => {
    const result = await glob("**/*.{ts,log}");
    expect(result.output).not.toContain("ignored.ts");
    expect(result.output).not.toContain(".turbo");
  });

  it("matches several names with braces", async () => {
    const result = await glob("**/{session,cost}.ts");
    expect(result.output.split("\n").sort()).toEqual(["src/agent/session.ts", "src/cost.ts"]);
  });

  it("finds dot folders", async () => {
    expect((await glob("**/*.yml")).output).toBe(".github/ci.yml");
  });

  it("says when nothing matches", async () => {
    expect((await glob("**/*.py")).output).toContain("No files matched");
  });

  it("refuses patterns that leave the working directory", async () => {
    const result = await glob("../**/*.ts");
    expect(result.isError).toBe(true);
    expect(result.output).toContain("inside the working directory");
  });
});

describe("grep", () => {
  it("returns matching lines with paths and line numbers", async () => {
    const result = await grep("abort");
    expect(result.output).toBe("src/agent/session.ts:2:  abort() {}");
    expect(result.summary).toBe("1 match");
  });

  it("respects .gitignore, skips node_modules and .git, searches dot folders", async () => {
    const result = await grep("class Session|session", { output_mode: "files" });
    expect(result.output.split("\n")).toEqual([
      ".github/ci.yml",
      "README.md",
      "src/agent/session.ts",
    ]);
  });

  it("supports case insensitive search and glob filters", async () => {
    const result = await grep("NIMBUS", { case_insensitive: true, output_mode: "files" });
    expect(result.output).toBe("README.md");
    expect((await grep("TODO", { glob: "*.md" })).output).toContain("No matches");
  });

  it("does not let the glob filter bring back ignored files", async () => {
    const result = await grep("class Session", { glob: "*.ts", output_mode: "files" });
    expect(result.output).toBe("src/agent/session.ts");
  });

  it("searches a single folder", async () => {
    expect((await grep("export", { path: "src/agent" })).output).toBe(
      "src/agent/session.ts:1:export class Session {",
    );
  });

  it("reports bad regex as an error", async () => {
    const result = await grep("(unclosed");
    expect(result.isError).toBe(true);
    expect(result.output).toContain("ripgrep failed");
  });

  it("refuses paths outside the working directory", async () => {
    expect((await grep("x", { path: "../" })).output).toContain("outside the working directory");
  });

  it("summarizes overflowing results by folder", async () => {
    const result = await grep("FIXME");
    expect(result.output.split("\n").filter((line) => line.includes(":FIXME"))).toHaveLength(200);
    expect(result.output).toContain("Showing the first 200 of 260 matches in 3 files");
    expect(result.output).toMatch(/big\/inner\s+150/);
    expect(result.output).toMatch(/big\s+100/);
    expect(result.output).toMatch(/tests\s+10/);
    expect(result.summary).toBe("200 of 260 matches");
  });

  it("summarizes overflowing file lists too", async () => {
    const result = await grep("NEEDLE", { output_mode: "files" });
    expect(result.output).toContain("Showing the first 200 of 205 files, sorted by path.");
    expect(result.output).toMatch(/many\s+205/);
    expect(result.summary).toBe("200 of 205 files");
  });
});
