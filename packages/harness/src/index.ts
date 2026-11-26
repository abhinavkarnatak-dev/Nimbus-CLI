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
export { bashOutputTool, bashTool, killProcessTool } from "./tools/bash.js";
export { blockedReason } from "./tools/blocklist.js";
export { editTool } from "./tools/edit.js";
export { FileTracker } from "./tools/file-state.js";
export { globTool } from "./tools/glob.js";
export { grepTool } from "./tools/grep.js";
export { ProcessManager, type ProcessSnapshot } from "./tools/processes.js";
export { readFileTool } from "./tools/read-file.js";
export { detectShell, type ShellInfo } from "./tools/shell.js";
export { writeFileTool } from "./tools/write-file.js";
export { truncateOutput } from "./tools/truncate.js";

import { bashOutputTool, bashTool, killProcessTool } from "./tools/bash.js";
import { editTool } from "./tools/edit.js";
import { globTool } from "./tools/glob.js";
import { grepTool } from "./tools/grep.js";
import { readFileTool } from "./tools/read-file.js";
import type { Tool } from "./tools/types.js";
import { writeFileTool } from "./tools/write-file.js";

export const defaultTools: Tool[] = [
  readFileTool,
  globTool,
  grepTool,
  editTool,
  writeFileTool,
  bashTool,
  bashOutputTool,
  killProcessTool,
];
