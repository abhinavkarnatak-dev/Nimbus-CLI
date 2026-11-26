import { estimateCounts, type UsageRecord } from "./db/ledger.js";

// Final usage is missing, so the cost has to be estimated
export const needsEstimate = (report: CallReport) =>
  !(report.end.kind === "finished" && report.end.usage);
import type { CallReport } from "./proxy/route.js";

// Turn a finished call into a ledger row
export function usageFromReport(report: CallReport, cachedRatio = 0): UsageRecord {
  const base = {
    userId: report.auth.userId,
    tokenId: report.auth.tokenId,
    model: report.model,
    promptCacheKey: report.promptCacheKey,
    durationMs: report.durationMs,
  };
  const { end } = report;
  if (end.kind === "finished" && end.usage) {
    return {
      ...base,
      outcome: "finished",
      responseStatus: end.status,
      counts: end.usage,
      estimated: false,
    };
  }
  const streamed = end.kind === "client_left" ? 0 : report.streamedChars;
  return {
    ...base,
    outcome: end.kind === "finished" ? "no_final_event" : end.kind,
    responseStatus: end.kind === "finished" ? end.status : undefined,
    counts: estimateCounts(report.requestChars, streamed, cachedRatio),
    estimated: true,
  };
}
