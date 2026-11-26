import { describe, expect, it } from "vitest";
import { usageFromReport } from "../src/billing.js";
import { sslFor } from "../src/db/client.js";
import { costMicroUsd, estimateCounts } from "../src/db/ledger.js";
import type { CallReport } from "../src/proxy/route.js";

const auth = { tokenId: "t1", userId: "u1", email: "a@test.dev", lastUsedAt: null };
const report = (end: CallReport["end"]): CallReport => ({
  auth,
  model: "gpt-6-luna",
  end,
  durationMs: 10,
  requestChars: 4000,
  streamedChars: 800,
});

describe("billing", () => {
  it("prices calls in whole micro-dollars, rounding up", () => {
    expect(
      costMicroUsd("gpt-6-luna", { inputTokens: 1_000_000, cachedTokens: 0, outputTokens: 0 }),
    ).toBe(100_000);
    expect(
      costMicroUsd("gpt-6.1-terra", { inputTokens: 0, cachedTokens: 0, outputTokens: 1 }),
    ).toBe(5);
    expect(costMicroUsd("gpt-6-luna", { inputTokens: 1, cachedTokens: 0, outputTokens: 0 })).toBe(
      1,
    );
    expect(() =>
      costMicroUsd("gpt-unknown", { inputTokens: 1, cachedTokens: 0, outputTokens: 0 }),
    ).toThrow();
  });

  it("estimates about four characters per token and never assumes cache hits", () => {
    expect(estimateCounts(4001, 9)).toEqual({
      inputTokens: 1001,
      cachedTokens: 0,
      outputTokens: 3,
    });
  });

  it("uses real usage when the final event arrived", () => {
    const usage = { inputTokens: 10, cachedTokens: 5, outputTokens: 2 };
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
