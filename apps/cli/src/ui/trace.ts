import type { ModelCall } from "@nimbus/harness";
import { formatCost, formatDuration, toolLabel } from "./format.js";

const number = (count: number) => count.toLocaleString("en-US");

// /trace: one line per model call, tools under it
export function traceReport(turn: number, calls: readonly ModelCall[]): string[] {
  const tools = calls.reduce((sum, call) => sum + call.tools.length, 0);
  const cost = calls.reduce((sum, call) => sum + call.cost, 0);
  const time = calls.reduce((sum, call) => sum + call.durationMs, 0);
  const lines = [
    `Reply ${turn}: ${calls.length} model call${calls.length === 1 ? "" : "s"}, ${tools} tool${tools === 1 ? "" : "s"}, ${formatCost(cost)}, ${formatDuration(time)}`,
  ];
  for (const call of calls) {
    const { inputTokens, cachedTokens, outputTokens } = call.usage;
    const cached = inputTokens ? Math.round((cachedTokens / inputTokens) * 100) : 0;
    const parts = [
      `${call.step}.${call.kind === "summary" ? " summary" : ""} ${call.model}${call.effort ? ` ${call.effort}` : ""}`,
      `in ${number(inputTokens)} (${cached}% cached)`,
      `out ${number(outputTokens)}`,
      formatCost(call.cost),
      formatDuration(call.durationMs),
    ];
    if (call.retries > 0) parts.push(`retried ${call.retries}x`);
    lines.push(parts.join("   "));
    for (const tool of call.tools) {
      const { verb, target } = toolLabel(tool.name, tool.args);
      const status = tool.ok === null ? "not finished" : tool.ok ? "ok" : "error";
      const when = tool.durationMs === null ? "" : `   ${formatDuration(tool.durationMs)}`;
      lines.push(`     ${`${verb} ${target}`.trim().slice(0, 60)}   ${status}${when}`);
    }
  }
  return lines;
}
