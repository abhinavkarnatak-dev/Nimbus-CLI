import { randomUUID } from "node:crypto";
import { costOf } from "../cost.js";
import {
  emptyUsage,
  isFunctionCall,
  type FunctionCallItem,
  type HistoryItem,
  type ModelClient,
  type Usage,
} from "../model/types.js";
import { FileTracker } from "../tools/file-state.js";
import { ProcessManager } from "../tools/processes.js";
import type { ShellInfo } from "../tools/shell.js";
import { truncateOutput } from "../tools/truncate.js";
import type { SearchFn, Tool, ToolContext, ToolResult } from "../tools/types.js";
import type { AgentEvent } from "./events.js";

export const DEFAULT_MAX_STEPS = 25;

export interface SessionOptions {
  client: ModelClient;
  model: string;
  instructions: string;
  cwd: string;
  tools?: Tool[];
  shell?: ShellInfo;
  search?: SearchFn;
  maxSteps?: number;
  id?: string;
}

function addUsage(total: Usage, usage: Usage): void {
  total.inputTokens += usage.inputTokens;
  total.cachedTokens += usage.cachedTokens;
  total.outputTokens += usage.outputTokens;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// HTTP status from SDK errors, so the UI can react (for example 401)
function errorStatus(error: unknown): number | undefined {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === "number" ? status : undefined;
}

export class Session {
  readonly id: string;
  readonly model: string;
  readonly cwd: string;
  readonly #client: ModelClient;
  readonly #instructions: string;
  readonly #tools: Map<string, Tool>;
  readonly #maxSteps: number;
  readonly #history: HistoryItem[] = [];
  readonly #usage: Usage = emptyUsage();
  readonly #files = new FileTracker();
  readonly #processes = new ProcessManager();
  readonly #shell: ShellInfo | undefined;
  readonly #search: SearchFn | undefined;
  #cost = 0;

  constructor(options: SessionOptions) {
    this.id = options.id ?? randomUUID();
    this.model = options.model;
    this.cwd = options.cwd;
    this.#client = options.client;
    this.#instructions = options.instructions;
    this.#tools = new Map((options.tools ?? []).map((tool) => [tool.name, tool]));
    this.#maxSteps = options.maxSteps ?? DEFAULT_MAX_STEPS;
    this.#shell = options.shell;
    this.#search = options.search;
  }

  get history(): readonly HistoryItem[] {
    return this.#history;
  }

  get usage(): Readonly<Usage> {
    return this.#usage;
  }

  get cost(): number {
    return this.#cost;
  }

  // Stop background processes we started
  async dispose(): Promise<void> {
    await this.#processes.killAll();
  }

  // Run one user turn, looping over tools
  async *send(text: string, signal?: AbortSignal): AsyncGenerator<AgentEvent> {
    const turnItems: HistoryItem[] = [{ role: "user", content: text }];
    const turnUsage = emptyUsage();
    let turnCost = 0;
    const ctx: ToolContext = {
      cwd: this.cwd,
      signal: signal ?? new AbortController().signal,
      files: this.#files,
      shell: this.#shell,
      processes: this.#processes,
      search: this.#search,
    };
    const toolSpecs = [...this.#tools.values()].map(({ name, description, parameters }) => ({
      name,
      description,
      parameters,
    }));

    try {
      for (let step = 1; ; step++) {
        if (step > this.#maxSteps) {
          this.#history.push(...turnItems);
          yield {
            type: "error",
            message: `Stopped after ${this.#maxSteps} steps in one turn. Send "continue" to keep going.`,
          };
          return;
        }

        let output: HistoryItem[] | undefined;
        const events = this.#client.stream(
          {
            model: this.model,
            instructions: this.#instructions,
            input: [...this.#history, ...turnItems],
            tools: toolSpecs.length > 0 ? toolSpecs : undefined,
            promptCacheKey: this.id,
          },
          signal,
        );
        for await (const event of events) {
          if (event.type === "text_delta") {
            yield { type: "text_delta", text: event.text };
          } else {
            output = event.output;
            const cost = costOf(this.model, event.usage);
            addUsage(turnUsage, event.usage);
            addUsage(this.#usage, event.usage);
            turnCost += cost;
            this.#cost += cost;
          }
        }
        if (!output) throw new Error("Model stream ended without completing");

        turnItems.push(...output);
        const calls = output.filter(isFunctionCall);
        if (calls.length === 0) break;

        for (const call of calls) {
          yield {
            type: "tool_call_start",
            id: call.call_id,
            name: call.name,
            args: call.arguments,
          };
          const started = Date.now();
          const result = await this.#runTool(call, ctx);
          turnItems.push({
            type: "function_call_output",
            call_id: call.call_id,
            output: truncateOutput(result.output),
          });
          yield {
            type: "tool_call_end",
            id: call.call_id,
            name: call.name,
            summary: result.summary ?? (result.isError ? result.output : "done"),
            isError: result.isError ?? false,
            durationMs: Date.now() - started,
            diff: result.diff,
            preview: result.preview,
          };
        }
      }

      this.#history.push(...turnItems);
      yield { type: "turn_complete", usage: turnUsage, cost: turnCost };
    } catch (error) {
      if (signal?.aborted) {
        yield { type: "turn_cancelled" };
        return;
      }
      const status = errorStatus(error);
      yield { type: "error", message: errorMessage(error), ...(status ? { status } : {}) };
    }
  }

  async #runTool(call: FunctionCallItem, ctx: ToolContext): Promise<ToolResult> {
    const tool = this.#tools.get(call.name);
    if (!tool) {
      const available = [...this.#tools.keys()].join(", ") || "none";
      return {
        output: `Error: unknown tool "${call.name}". Available tools: ${available}.`,
        isError: true,
      };
    }
    return tool.execute(call.arguments, ctx);
  }
}
