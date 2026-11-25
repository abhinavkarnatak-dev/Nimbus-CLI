import type {
  ResponseFunctionToolCall,
  ResponseInputItem,
} from "openai/resources/responses/responses";
import type { ToolSpec } from "../tools/types.js";

export type HistoryItem = ResponseInputItem;
export type FunctionCallItem = ResponseFunctionToolCall;

export function isFunctionCall(item: HistoryItem): item is FunctionCallItem {
  return item.type === "function_call";
}

export interface Usage {
  inputTokens: number;
  cachedTokens: number;
  outputTokens: number;
}

export interface ModelRequest {
  model: string;
  instructions: string;
  input: HistoryItem[];
  tools?: ToolSpec[];
  promptCacheKey?: string;
}

export type ModelEvent =
  { type: "text_delta"; text: string } | { type: "completed"; output: HistoryItem[]; usage: Usage };

export interface ModelClient {
  stream(request: ModelRequest, signal?: AbortSignal): AsyncIterable<ModelEvent>;
}

export function emptyUsage(): Usage {
  return { inputTokens: 0, cachedTokens: 0, outputTokens: 0 };
}
