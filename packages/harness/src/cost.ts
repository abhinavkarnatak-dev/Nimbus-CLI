import type { Usage } from "./model/types.js";

// USD per 1M tokens
export interface ModelPrice {
  input: number;
  cached: number;
  // 30-minute cache write, the default
  cacheWrite: number;
  output: number;
}

// Every model Nimbus offers; the server allows only these
export const MODEL_PRICES: Record<string, ModelPrice> = {
  "gpt-6.2-astra": { input: 8, cached: 0.4, cacheWrite: 10, output: 40 },
  "gpt-6.2-sol": { input: 2, cached: 0.1, cacheWrite: 2.5, output: 10 },
  "gpt-6.1-terra": { input: 1, cached: 0.05, cacheWrite: 1.25, output: 5 },
  "gpt-6-luna": { input: 0.1, cached: 0.01, cacheWrite: 0.125, output: 0.5 },
  "gpt-6-astra": { input: 10, cached: 1, cacheWrite: 12.5, output: 50 },
  "gpt-6.1-sol": { input: 2, cached: 0.1, cacheWrite: 2.5, output: 10 },
};

// Above this many input tokens the whole request costs more
export const LONG_CONTEXT_TOKENS = 272_000;
const LONG_INPUT_RATE = 2;
const LONG_OUTPUT_RATE = 1.5;

// Nimbus keeps conversations below the long-context price
export const CONTEXT_LIMIT = LONG_CONTEXT_TOKENS;

// Cost in micro-dollars, not rounded
export function costMicroUsd(price: ModelPrice, usage: Usage): number {
  const long = usage.inputTokens > LONG_CONTEXT_TOKENS;
  const inputRate = long ? LONG_INPUT_RATE : 1;
  const outputRate = long ? LONG_OUTPUT_RATE : 1;
  const plain = Math.max(usage.inputTokens - usage.cachedTokens - usage.cacheWriteTokens, 0);
  return (
    (plain * price.input +
      usage.cachedTokens * price.cached +
      usage.cacheWriteTokens * price.cacheWrite) *
      inputRate +
    usage.outputTokens * price.output * outputRate
  );
}

export function costOf(model: string, usage: Usage): number {
  const price = MODEL_PRICES[model];
  return price ? costMicroUsd(price, usage) / 1_000_000 : 0;
}

// Money the cache saved: cheaper reads minus dearer writes
export function cacheSavings(model: string, usage: Usage): number {
  const price = MODEL_PRICES[model];
  if (!price) return 0;
  const saved =
    usage.cachedTokens * (price.input - price.cached) -
    usage.cacheWriteTokens * (price.cacheWrite - price.input);
  return saved / 1_000_000;
}
