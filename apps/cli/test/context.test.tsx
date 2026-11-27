import { tmpdir } from "node:os";
import { FakeModelClient, Session, type ContextUsage } from "@nimbus/harness";
import { render } from "ink-testing-library";
import { describe, expect, it } from "vitest";
import { contextReport } from "../src/ui/App.js";
import { contextColor, contextPercent, StatusBar } from "../src/ui/StatusBar.js";
import { theme } from "../src/ui/theme.js";

const context = (tokens: number, estimated = false): ContextUsage => ({
  tokens,
  limit: 272_000,
  estimated,
  parts: {
    system: 2000,
    tools: 4000,
    conversation: 1000,
    toolCalls: tokens - 7400,
    reasoning: 400,
  },
});

const usage = {
  inputTokens: 100_000,
  cachedTokens: 90_000,
  cacheWriteTokens: 5_000,
  outputTokens: 900,
};

describe("context display", () => {
  it("shows the percent in the status bar, at least 1% once anything is there", () => {
    expect(contextPercent(context(32_640))).toBe(12);
    expect(contextPercent(context(500))).toBe(1);
    const { lastFrame } = render(
      <StatusBar model="gpt-6-luna" hint="" context={context(32_640)} />,
    );
    expect(lastFrame()).toContain("gpt-6-luna · context 12%");
  });

  it("turns yellow at 60% and red at 80%", () => {
    expect(contextColor(59)).toBe(theme.muted);
    expect(contextColor(60)).toBe(theme.warning);
    expect(contextColor(80)).toBe(theme.error);
  });

  it("lists what fills the context and what the cache saved", () => {
    const report = contextReport(context(32_640), usage, "gpt-6-luna");
    const lines = report.split("\n");
    expect(lines[0]).toBe("Context  32,640 of 272,000 tokens (12%)");
    expect(lines[1]).toBe(`   ${"█".repeat(2)}${"░".repeat(18)}`);
    expect(report).toContain("Tool calls           25,240");
    expect(report).toContain("90% of this session's input came from the cache, saved $0.0080");
  });

  it("says when the size is estimated and when nothing was sent yet", () => {
    const empty = { inputTokens: 0, cachedTokens: 0, cacheWriteTokens: 0, outputTokens: 0 };
    const report = contextReport(context(8000, true), empty, "gpt-6-luna");
    expect(report).toContain("(3%), estimated");
    expect(report).toContain("Cache    no model calls yet");
  });

  it("reads the live numbers from a session", async () => {
    const session = new Session({
      client: new FakeModelClient([{ text: "hi", usage: { inputTokens: 5000, outputTokens: 20 } }]),
      model: "gpt-6-luna",
      instructions: "test",
      cwd: tmpdir(),
    });
    for await (const _event of session.send("hello")) void _event;
    expect(contextReport(session.context(), session.usage, "gpt-6-luna")).toContain(
      "Context  5,020 of 272,000 tokens (2%)",
    );
  });
});
