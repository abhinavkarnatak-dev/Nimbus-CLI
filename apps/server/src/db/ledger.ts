import { MODEL_PRICES } from "@nimbus/harness/cost";
import { and, desc, eq, sql } from "drizzle-orm";
import type { Db } from "./client.js";
import { usageEvents, users, type USAGE_OUTCOMES } from "./schema.js";

export interface TokenCounts {
  inputTokens: number;
  cachedTokens: number;
  outputTokens: number;
}

export interface UsageRecord {
  userId: string;
  tokenId: string;
  model: string;
  promptCacheKey?: string;
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
export function estimateCounts(
  requestChars: number,
  streamedChars: number,
  cachedRatio = 0,
): TokenCounts {
  const inputTokens = Math.ceil(requestChars / 4);
  return {
    inputTokens,
    cachedTokens: Math.floor(inputTokens * Math.min(Math.max(cachedRatio, 0), 1)),
    outputTokens: Math.ceil(streamedChars / 4),
  };
}

// Cached share of the last finished call in the same session
export async function lastCachedRatio(
  db: Db,
  userId: string,
  promptCacheKey: string | undefined,
): Promise<number> {
  if (!promptCacheKey) return 0;
  const [row] = await db
    .select({ input: usageEvents.inputTokens, cached: usageEvents.cachedTokens })
    .from(usageEvents)
    .where(
      and(
        eq(usageEvents.userId, userId),
        eq(usageEvents.promptCacheKey, promptCacheKey),
        eq(usageEvents.estimated, false),
      ),
    )
    .orderBy(desc(usageEvents.id))
    .limit(1);
  return row && row.input > 0 ? row.cached / row.input : 0;
}

// Ledger row and the user's running total, together
export async function recordUsage(db: Db, record: UsageRecord): Promise<number> {
  const cost = costMicroUsd(record.model, record.counts);
  await db.transaction(async (tx) => {
    await tx.insert(usageEvents).values({
      userId: record.userId,
      tokenId: record.tokenId,
      model: record.model,
      promptCacheKey: record.promptCacheKey ?? null,
      outcome: record.outcome,
      responseStatus: record.responseStatus ?? null,
      inputTokens: record.counts.inputTokens,
      cachedTokens: record.counts.cachedTokens,
      outputTokens: record.counts.outputTokens,
      costMicroUsd: cost,
      estimated: record.estimated,
      durationMs: record.durationMs,
    });
    await tx
      .update(users)
      .set({ spentMicroUsd: sql`${users.spentMicroUsd} + ${cost}` })
      .where(eq(users.id, record.userId));
  });
  return cost;
}

// Everything spent by everyone, for the global budget
export async function totalSpent(db: Db): Promise<number> {
  const [row] = await db
    .select({ total: sql<string>`coalesce(sum(${users.spentMicroUsd}), 0)` })
    .from(users);
  return Number(row?.total ?? 0);
}
