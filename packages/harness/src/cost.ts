import type { Usage } from "./model/types.js";

// USD per 1M tokens
export interface ModelPrice {
  input: number;
  cached: number;
  output: number;
}

export const MODEL_PRICES: Record<string, ModelPrice> = {
  "gpt-6-luna": { input: 0.1, cached: 0.01, output: 0.5 },
  "gpt-6.1-terra": { input: 1, cached: 0.05, output: 5 },
};

export function costOf(model: string, usage: Usage): number {
  const price = MODEL_PRICES[model];
  if (!price) return 0;
  const uncached = usage.inputTokens - usage.cachedTokens;
  return (
    (uncached * price.input +
      usage.cachedTokens * price.cached +
      usage.outputTokens * price.output) /
    1_000_000
  );
}
