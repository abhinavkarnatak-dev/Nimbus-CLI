export const HARNESS_VERSION = "0.0.0";

export { DEFAULT_MAX_STEPS, Session, type SessionOptions } from "./agent/session.js";
export type { AgentEvent } from "./agent/events.js";
export {
  MemorySessionStore,
  type MemoryTurn,
  type SessionInfo,
  type SessionStore,
  type ToolView,
  type TurnStatus,
} from "./agent/store.js";
export {
  BUDGET_NOTE,
  CONNECTION_FAILED,
  STOPPED_NOTE,
  STOPPED_TOOL_OUTPUT,
} from "./agent/session.js";
export {
  COMPACT_AT,
  COMPACT_REQUEST,
  compactRequest,
  removedOutputNote,
  SUMMARY_PREFIX,
  summaryItem,
} from "./agent/compact.js";
export {
  closeTurn,
  ERROR_NOTE,
  ERROR_TOOL_OUTPUT,
  historyFromTurns,
  INTERRUPTED_NOTE,
  INTERRUPTED_TOOL_OUTPUT,
  type ResumeState,
  type SavedTurnItems,
} from "./agent/resume.js";
export { idleFetch, OpenAIModelClient, type OpenAIModelClientOptions } from "./model/openai.js";
export {
  ConnectionLostError,
  isNetworkError,
  isRetryable,
  MAX_RETRIES,
  RETRY_DELAY_MS,
  retryDelayMs,
  retryReason,
  sleep,
} from "./model/retry.js";
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
export {
  CONTEXT_LIMIT,
  costMicroUsd,
  costOf,
  LONG_CONTEXT_TOKENS,
  MODEL_PRICES,
  cacheSavings,
  type ModelPrice,
} from "./cost.js";
export {
  contextParts,
  estimateTokens,
  type ContextParts,
  type ContextUsage,
} from "./agent/context.js";
export {
  buildSystemPrompt,
  detectEnvironment,
  type Environment,
  type PromptExtras,
} from "./prompt/system.js";
export {
  loadProjectDocs,
  MAX_DOC_CHARS,
  type Memories,
  type ProjectDoc,
} from "./prompt/project.js";
export { rememberTool, type MemoryBook, type MemoryScope } from "./tools/remember.js";
export { loadSkillTool } from "./tools/skill.js";
export {
  loadSkills,
  MAX_LISTED_SKILLS,
  parseSkillFile,
  parseSkillRequest,
  skillRequest,
  skillsSection,
  type Skill,
  type SkillSource,
} from "./prompt/skills.js";
export { BUILT_IN_SKILLS } from "./prompt/builtin-skills.js";
export {
  defineTool,
  type SearchFn,
  type SearchRequest,
  type SearchResult,
  type Tool,
  type ToolContext,
  type ToolDefinition,
  type ToolResult,
  type ToolSpec,
} from "./tools/types.js";
export { bashOutputTool, bashTool, killProcessTool } from "./tools/bash.js";
export { blockedReason } from "./tools/blocklist.js";
export { editTool } from "./tools/edit.js";
export {
  ChangeLog,
  MAX_SNAPSHOT_BYTES,
  type FileChange,
  type UndoFileResult,
  type UndoRequest,
  type UndoResult,
} from "./tools/changes.js";
export { describeUndo, undoTool } from "./tools/undo.js";
export { todoLines, todosFrom, todosTool, type Todo, type TodoStatus } from "./tools/todos.js";
export { REPEAT_NOTE, SAME_ERROR_NOTE, VERIFY_REMINDER } from "./agent/checks.js";
export {
  DECLINED_NOTE,
  SKIPPED_NOTE,
  type ApprovalDecision,
  type ApprovalRequest,
  type ApproveFn,
} from "./agent/approval.js";
export { alwaysAskReason, isSecretPath, mentionsSecret, secretRefusal } from "./tools/secrets.js";
export { FileTracker } from "./tools/file-state.js";
export { globTool } from "./tools/glob.js";
export { grepTool } from "./tools/grep.js";
export { ProcessManager, type ProcessSnapshot } from "./tools/processes.js";
export { readFileTool } from "./tools/read-file.js";
export { detectShell, type ShellInfo } from "./tools/shell.js";
export { writeFileTool } from "./tools/write-file.js";
export { webSearchTool } from "./tools/web-search.js";
export { MAX_TOOL_OUTPUT, truncateOutput } from "./tools/truncate.js";

import { bashOutputTool, bashTool, killProcessTool } from "./tools/bash.js";
import { editTool } from "./tools/edit.js";
import { globTool } from "./tools/glob.js";
import { grepTool } from "./tools/grep.js";
import { readFileTool } from "./tools/read-file.js";
import type { Tool } from "./tools/types.js";
import { todosTool } from "./tools/todos.js";
import { undoTool } from "./tools/undo.js";
import { writeFileTool } from "./tools/write-file.js";

export const defaultTools: Tool[] = [
  readFileTool,
  globTool,
  grepTool,
  editTool,
  writeFileTool,
  undoTool,
  todosTool,
  bashTool,
  bashOutputTool,
  killProcessTool,
];
