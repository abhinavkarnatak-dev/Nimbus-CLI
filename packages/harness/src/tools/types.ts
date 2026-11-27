import { z } from "zod";
import type { ChangeLog } from "./changes.js";
import type { FileTracker } from "./file-state.js";
import type { ProcessManager } from "./processes.js";
import type { ShellInfo } from "./shell.js";

export interface SearchRequest {
  query: string;
  topic: "general" | "news";
  recency: "day" | "week" | "month" | "year" | null;
  maxResults: number;
}

export interface SearchResult {
  title: string;
  url: string;
  content: string;
  publishedDate?: string;
}

// Web search is provided by the app, the harness never calls a provider itself
export type SearchFn = (request: SearchRequest, signal: AbortSignal) => Promise<SearchResult[]>;

export interface ToolContext {
  cwd: string;
  signal: AbortSignal;
  files: FileTracker;
  shell?: ShellInfo;
  processes?: ProcessManager;
  search?: SearchFn;
  // Copies of changed files, for undo_changes
  changes?: ChangeLog;
}

export interface ToolResult {
  output: string;
  isError?: boolean;
  summary?: string;
  diff?: string;
  preview?: string;
}

export interface ToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface Tool extends ToolSpec {
  execute(rawArgs: string, ctx: ToolContext): Promise<ToolResult>;
}

export interface ToolDefinition<Input> {
  name: string;
  description: string;
  schema: z.ZodType<Input>;
  run(input: Input, ctx: ToolContext): Promise<ToolResult>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// Wrap tool with parsing and validation
export function defineTool<Input>(definition: ToolDefinition<Input>): Tool {
  const parameters = { ...z.toJSONSchema(definition.schema) } as Record<string, unknown>;
  delete parameters.$schema;

  return {
    name: definition.name,
    description: definition.description,
    parameters,
    async execute(rawArgs, ctx) {
      let json: unknown;
      try {
        json = JSON.parse(rawArgs);
      } catch {
        return { output: "Error: arguments were not valid JSON.", isError: true };
      }

      const parsed = definition.schema.safeParse(json);
      if (!parsed.success) {
        return {
          output: `Error: invalid arguments.\n${z.prettifyError(parsed.error)}`,
          isError: true,
        };
      }

      try {
        return await definition.run(parsed.data, ctx);
      } catch (error) {
        if (ctx.signal.aborted) throw error;
        return { output: `Error: ${errorMessage(error)}`, isError: true };
      }
    },
  };
}
