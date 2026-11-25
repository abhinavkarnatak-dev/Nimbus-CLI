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
});
