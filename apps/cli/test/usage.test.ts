import { describe, expect, it } from "vitest";
import { parseBudget, usageReport } from "../src/ui/App.js";
import { applyEvent } from "../src/ui/transcript.js";

const usage = {
  inputTokens: 1_200_000,
  cachedTokens: 1_128_000,
  cacheWriteTokens: 20_000,
  outputTokens: 32_400,
};

describe("/usage and /budget", () => {
  it("shows tokens, cache, cost and the budget", () => {
    expect(usageReport(usage, 0.0412, "gpt-6-luna", 0.5)).toEqual([
      "Input     1.2M tokens (94% from the cache)",
      "Output    32.4k tokens",
      "Cost      $0.04 (the cache saved $0.10)",
      "Budget    $0.04 of $0.50",
    ]);
    expect(usageReport(usage, 0.0412, "gpt-6-luna", null)).toHaveLength(3);
  });

  it("reads budgets in dollars", () => {
    expect(parseBudget("0.50")).toBe(0.5);
    expect(parseBudget("$2")).toBe(2);
    expect(parseBudget("off")).toBeNull();
    expect(parseBudget("abc")).toBeUndefined();
    expect(parseBudget("-1")).toBeUndefined();
  });

  it("shows how much compaction freed", () => {
    const items = applyEvent([], {
      type: "compacted",
      before: 220_410,
      after: 28_900,
      summarized: true,
    });
    expect(items[0]).toMatchObject({ text: "Conversation compacted: 220,410 → 28,900 tokens" });
    const pruned = applyEvent([], {
      type: "compacted",
      before: 220_410,
      after: 120_000,
      summarized: false,
    });
    expect(pruned[0]).toMatchObject({
      text: expect.stringContaining("(old tool outputs removed)"),
    });
  });
});
