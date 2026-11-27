import type { HistoryItem } from "../model/types.js";
import type { ToolSpec } from "../tools/types.js";

// Rough rule for text the API has not counted yet
const CHARS_PER_TOKEN = 4;

export const estimateTokens = (chars: number) => Math.ceil(chars / CHARS_PER_TOKEN);

// Tokens per part of the request
export interface ContextParts {
  system: number;
  tools: number;
  conversation: number;
  toolCalls: number;
  reasoning: number;
}

export interface ContextUsage {
  tokens: number;
  limit: number;
  // False right after a model call, when the API gave the size
  estimated: boolean;
  parts: ContextParts;
}

function contentChars(content: unknown): number {
  if (typeof content === "string") return content.length;
  if (!Array.isArray(content)) return 0;
  return content.reduce((sum: number, part: { text?: unknown }) => {
    return sum + (typeof part?.text === "string" ? part.text.length : 0);
  }, 0);
}

// Which part an item belongs to, and its text size
export function itemChars(item: HistoryItem): { part: keyof ContextParts; chars: number } {
  const fields = item as {
    type?: string;
    content?: unknown;
    name?: string;
    arguments?: string;
    output?: unknown;
  };
  if (fields.type === "reasoning") return { part: "reasoning", chars: 0 };
  if (fields.type === "function_call") {
    return {
      part: "toolCalls",
      chars: (fields.name?.length ?? 0) + (fields.arguments?.length ?? 0),
    };
  }
  if (fields.type === "function_call_output") {
    const output =
      typeof fields.output === "string" ? fields.output : JSON.stringify(fields.output);
    return { part: "toolCalls", chars: output?.length ?? 0 };
  }
  return { part: "conversation", chars: contentChars(fields.content) };
}

export function estimateItems(items: readonly HistoryItem[]): number {
  return estimateTokens(items.reduce((sum, item) => sum + itemChars(item).chars, 0));
}

// Estimated parts, scaled so they add up to the real total
export function contextParts(
  instructions: string,
  tools: readonly ToolSpec[],
  items: readonly HistoryItem[],
  total: number | null,
): ContextParts {
  const chars = {
    system: instructions.length,
    tools: JSON.stringify(tools).length,
    conversation: 0,
    toolCalls: 0,
  };
  for (const item of items) {
    const { part, chars: size } = itemChars(item);
    if (part !== "reasoning") chars[part] += size;
  }
  const parts: ContextParts = {
    system: estimateTokens(chars.system),
    tools: estimateTokens(chars.tools),
    conversation: estimateTokens(chars.conversation),
    toolCalls: estimateTokens(chars.toolCalls),
    reasoning: 0,
  };
  const known = parts.system + parts.tools + parts.conversation + parts.toolCalls;
  if (total === null || known === 0) return parts;
  // Encrypted reasoning has no readable size, so it gets what is left
  if (total >= known) return { ...parts, reasoning: total - known };
  const scale = total / known;
  const scaled = {
    system: Math.round(parts.system * scale),
    tools: Math.round(parts.tools * scale),
    conversation: Math.round(parts.conversation * scale),
    toolCalls: 0,
    reasoning: 0,
  };
  scaled.toolCalls = total - scaled.system - scaled.tools - scaled.conversation;
  return scaled;
}
