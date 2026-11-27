import { describe, expect, it } from "vitest";
import { usageFromReport } from "../src/billing.js";
import { sslFor } from "../src/db/client.js";
import { costMicroUsd, estimateCounts } from "../src/db/ledger.js";
import type { CallReport } from "../src/proxy/route.js";

const auth = {
  tokenId: "t1",
  userId: "u1",
  email: "a@test.dev",
  lastUsedAt: null,
  spentMicroUsd: 0,
  quotaMicroUsd: null,
};
const report = (end: CallReport["end"]): CallReport => ({
  auth,
  model: "gpt-6-luna",
  end,
  durationMs: 10,
  requestChars: 4000,
  streamedChars: 800,
});

describe("billing", () => {
  const counts = (input: number, cached: number, writes: number, output: number) => ({
    inputTokens: input,
    cachedTokens: cached,
    cacheWriteTokens: writes,
    outputTokens: output,
  });

  it("prices calls in whole micro-dollars, rounding up", () => {
    expect(costMicroUsd("gpt-6-luna", counts(100_000, 0, 0, 0))).toBe(10_000);
    expect(costMicroUsd("gpt-6.1-terra", counts(0, 0, 0, 1))).toBe(5);
    expect(costMicroUsd("gpt-6-luna", counts(1, 0, 0, 0))).toBe(1);
    expect(() => costMicroUsd("gpt-unknown", counts(1, 0, 0, 0))).toThrow();
  });

  it("bills cache writes above plain input and long prompts at the long-context rate", () => {
    // 100k tokens written to the cache cost 1.25x plain input
    expect(costMicroUsd("gpt-6-luna", counts(100_000, 0, 100_000, 0))).toBe(12_500);
    expect(costMicroUsd("gpt-6-luna", counts(100_000, 100_000, 0, 0))).toBe(1_000);
    // Over 272k input: 2x input, 1.5x output for the whole request
    expect(costMicroUsd("gpt-6-luna", counts(300_000, 0, 0, 1000))).toBe(60_000 + 750);
  });

  it("estimates about four characters per token and treats uncached input as written", () => {
    expect(estimateCounts(4001, 9)).toEqual(counts(1001, 0, 1001, 3));
    expect(estimateCounts(4000, 0, 0.75)).toEqual(counts(1000, 750, 250, 0));
  });

  it("uses real usage when the final event arrived", () => {
    const usage = { inputTokens: 10, cachedTokens: 5, cacheWriteTokens: 0, outputTokens: 2 };
    expect(usageFromReport(report({ kind: "finished", status: "completed", usage }))).toMatchObject(
      {
        outcome: "finished",
        counts: usage,
        estimated: false,
      },
    );
  });

  it("estimates when the usage is missing", () => {
    expect(usageFromReport(report({ kind: "cancelled" }))).toMatchObject({
      outcome: "cancelled",
      counts: { inputTokens: 1000, cachedTokens: 0, outputTokens: 200 },
      estimated: true,
    });
    expect(usageFromReport(report({ kind: "client_left" })).counts.outputTokens).toBe(0);
    expect(
      usageFromReport(report({ kind: "finished", status: "completed", usage: null })).outcome,
    ).toBe("no_final_event");
  });
});

describe("database TLS", () => {
  it("checks the certificate only when we have the CA", () => {
    expect(sslFor({ url: "postgresql://u:p@localhost:5432/db" })).toBe(false);
    expect(sslFor({ url: "postgresql://u:p@pooler.supabase.com:5432/db" })).toEqual({
      rejectUnauthorized: false,
    });
    expect(sslFor({ url: "postgresql://u:p@pooler.supabase.com:5432/db", caCert: "PEM" })).toEqual({
      ca: "PEM",
      rejectUnauthorized: true,
    });
  });
});
