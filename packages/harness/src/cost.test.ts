import { describe, expect, it } from "vitest";
import { cacheSavings, costOf } from "./cost.js";

const usage = (input: number, cached: number, writes: number, output: number) => ({
  inputTokens: input,
  cachedTokens: cached,
  cacheWriteTokens: writes,
  outputTokens: output,
});

describe("costOf", () => {
  it("bills plain input, cache reads, cache writes and output at their own rates", () => {
    // 100k plain, 50k read, 20k written, 10k out
    const cost = costOf("gpt-6-luna", usage(170_000, 50_000, 20_000, 10_000));
    expect(cost).toBeCloseTo(0.01 + 0.0005 + 0.0025 + 0.005, 10);
  });

  it("charges the long-context rate for the whole request above 272k input", () => {
    const short = costOf("gpt-6-luna", usage(272_000, 0, 0, 1000));
    const long = costOf("gpt-6-luna", usage(272_001, 0, 0, 1000));
    expect(short).toBeCloseTo(0.0272 + 0.0005, 10);
    expect(long).toBeCloseTo(272_001 * 0.2e-6 + 1000 * 0.75e-6, 10);
  });

  it("knows what the cache saved", () => {
    // 90k read saves 0.09 per 1M each, 5k written costs 0.025 per 1M extra
    expect(cacheSavings("gpt-6-luna", usage(100_000, 90_000, 5_000, 1000))).toBeCloseTo(
      0.0081 - 0.000125,
      10,
    );
    expect(cacheSavings("unknown-model", usage(1, 1, 0, 0))).toBe(0);
  });
});
