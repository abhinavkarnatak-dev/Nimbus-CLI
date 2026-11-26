import { MODEL_PRICES } from "@nimbus/harness/cost";
import type { Db } from "./client.js";
import { usageEvents, type USAGE_OUTCOMES } from "./schema.js";

export interface TokenCounts {
  inputTokens: number;
  cachedTokens: number;
  outputTokens: number;
}

export interface UsageRecord {
  userId: string;
  tokenId: string;
  model: string;
  outcome: (typeof USAGE_OUTCOMES)[number];
  responseStatus?: string;
  counts: TokenCounts;
  estimated: boolean;
  durationMs: number;
}

// Prices are USD per 1M tokens, so this is micro-dollars
export function costMicroUsd(model: string, counts: TokenCounts): number {
  const price = MODEL_PRICES[model];
  if (!price) throw new Error(`No price for model ${model}.`);
  const uncached = Math.max(counts.inputTokens - counts.cachedTokens, 0);
  return Math.ceil(
    uncached * price.input +
      counts.cachedTokens * price.cached +
      counts.outputTokens * price.output,
  );
}

// Rough count when the final usage never came: about 4 characters per token
export function estimateCounts(requestChars: number, streamedChars: number): TokenCounts {
  return {
    inputTokens: Math.ceil(requestChars / 4),
    cachedTokens: 0,
    outputTokens: Math.ceil(streamedChars / 4),
  };
}

export async function recordUsage(db: Db, record: UsageRecord): Promise<void> {
  await db.insert(usageEvents).values({
    userId: record.userId,
    tokenId: record.tokenId,
    model: record.model,
    outcome: record.outcome,
    responseStatus: record.responseStatus ?? null,
    inputTokens: record.counts.inputTokens,
    cachedTokens: record.counts.cachedTokens,
    outputTokens: record.counts.outputTokens,
    costMicroUsd: costMicroUsd(record.model, record.counts),
    estimated: record.estimated,
    durationMs: record.durationMs,
  });
}
