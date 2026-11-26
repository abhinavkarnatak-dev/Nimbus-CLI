export const HARNESS_VERSION = "0.0.0";

export { DEFAULT_MAX_STEPS, Session, type SessionOptions } from "./agent/session.js";
export type { AgentEvent } from "./agent/events.js";
export { OpenAIModelClient, type OpenAIModelClientOptions } from "./model/openai.js";
export { FakeModelClient, type FakeToolCall, type FakeTurn } from "./model/fake.js";
export {
  emptyUsage,
  isFunctionCall,
  type FunctionCallItem,
  type HistoryItem,
  type ModelClient,
  type ModelEvent,
  type ModelRequest,
  type Usage,
} from "./model/types.js";
export { costOf, MODEL_PRICES, type ModelPrice } from "./cost.js";
export { buildSystemPrompt, detectEnvironment, type Environment } from "./prompt/system.js";
export {
  defineTool,
  type Tool,
  type ToolContext,
  type ToolDefinition,
  type ToolResult,
  type ToolSpec,
} from "./tools/types.js";
export { globTool } from "./tools/glob.js";
export { grepTool } from "./tools/grep.js";
export { readFileTool } from "./tools/read-file.js";
export { truncateOutput } from "./tools/truncate.js";

import { globTool } from "./tools/glob.js";
import { grepTool } from "./tools/grep.js";
import { readFileTool } from "./tools/read-file.js";
import type { Tool } from "./tools/types.js";

export const defaultTools: Tool[] = [readFileTool, globTool, grepTool];
