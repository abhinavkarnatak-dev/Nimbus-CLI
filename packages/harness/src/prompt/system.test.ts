import { describe, expect, it } from "vitest";
import { buildSystemPrompt, detectEnvironment } from "./system.js";

describe("system prompt", () => {
  it("includes the environment and has no long dashes", () => {
    const prompt = buildSystemPrompt({
      os: "Windows",
      shell: "PowerShell",
      cwd: "C:\\code\\app",
      date: "2026-11-26",
    });

    expect(prompt).toContain("Operating system: Windows");
    expect(prompt).toContain("Working directory: C:\\code\\app");
    expect(prompt).toContain("Date: 2026-11-26");
    expect(prompt).not.toMatch(/[\u2013\u2014]/);
  });

  it("detects a date without a time", () => {
    expect(detectEnvironment().date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("only mentions tools that exist", () => {
    const env = { os: "Linux", shell: "bash", cwd: "/app", date: "2026-11-26" };
    expect(buildSystemPrompt(env)).not.toContain("Tools:");

    const readOnly = buildSystemPrompt(env, ["read_file"]);
    expect(readOnly).toContain("use read_file");
    expect(readOnly).not.toContain("use grep");
    expect(readOnly).not.toContain("use glob");

    const all = buildSystemPrompt(env, ["read_file", "glob", "grep"]);
    expect(all).toContain("use glob");
    expect(all).toContain("grep first to find the line");
    expect(all).not.toMatch(/[\u2013\u2014]/);
  });

  it("adds editing rules only when edit tools exist", () => {
    const env = { os: "Linux", shell: "bash", cwd: "/app", date: "2026-11-26" };
    const readOnly = buildSystemPrompt(env, ["read_file", "grep"]);
    expect(readOnly).toContain("You can read and search files");
    expect(readOnly).not.toContain("Editing files:");

    const withEdit = buildSystemPrompt(env, ["read_file", "edit", "write_file"]);
    expect(withEdit).toContain("You can read, search and edit files");
    expect(withEdit).toContain("Editing files:");
  });
});
