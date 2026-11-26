import { estimateCounts, type UsageRecord } from "./db/ledger.js";
import type { CallReport } from "./proxy/route.js";

// Turn a finished call into a ledger row
export function usageFromReport(report: CallReport): UsageRecord {
  const base = {
    userId: report.auth.userId,
    tokenId: report.auth.tokenId,
    model: report.model,
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
    counts: estimateCounts(report.requestChars, streamed),
    estimated: true,
  };
}
