import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { costOf } from "../cost.js";
import {
  emptyUsage,
  isFunctionCall,
  type FunctionCallItem,
  type HistoryItem,
  type ModelClient,
  type Usage,
} from "../model/types.js";
import { ChangeLog } from "../tools/changes.js";
import { FileTracker } from "../tools/file-state.js";
import { ProcessManager } from "../tools/processes.js";
import type { ShellInfo } from "../tools/shell.js";
import { MAX_TOOL_OUTPUT, truncateOutput } from "../tools/truncate.js";
import type { SearchFn, Tool, ToolContext, ToolResult, ToolSpec } from "../tools/types.js";
import { CONTEXT_LIMIT } from "../cost.js";
import { contextParts, estimateItems, type ContextUsage } from "./context.js";
import type { AgentEvent } from "./events.js";
import {
  closeTurn,
  ERROR_NOTE,
  ERROR_TOOL_OUTPUT,
  openCallOutputs,
  type ResumeState,
} from "./resume.js";
import type { SessionStore, ToolView, TurnStatus } from "./store.js";
import {
  ConnectionLostError,
  isNetworkError,
  isRetryable,
  MAX_RETRIES,
  retryDelayMs,
  retryReason,
  sleep,
} from "../model/retry.js";

export const DEFAULT_MAX_STEPS = 25;

// Seen by the model after a turn the user stopped
export const STOPPED_NOTE = "[The user stopped this reply before it finished.]";
export const STOPPED_TOOL_OUTPUT =
  "Stopped by the user before this finished. It may have partly run, so check before running it again.";

// Shown when every retry failed to reach the server
export const CONNECTION_FAILED =
  "Could not reach the server, even after retrying. Check your internet connection and try again.";

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
  // Saves every step so the session survives crashes and can be resumed
  store?: SessionStore;
  // Continue a saved session; id must be the saved one
  resume?: ResumeState;
  // Full long tool outputs go here, one folder per session
  outputDir?: string;
  // Retries for a failed model call, never for tools
  maxRetries?: number;
  retryDelay?: (error: unknown, attempt: number) => number;
}

interface TurnState {
  turn: number;
  items: HistoryItem[];
  usage: Usage;
  cost: number;
  lastCall: Usage;
}

function addUsage(total: Usage, usage: Usage): void {
  total.inputTokens += usage.inputTokens;
  total.cachedTokens += usage.cachedTokens;
  total.cacheWriteTokens += usage.cacheWriteTokens;
  total.outputTokens += usage.outputTokens;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// HTTP status and error code from SDK errors, so the UI can react
function errorDetails(error: unknown): { status?: number; code?: string } {
  const { status, code } = (error ?? {}) as { status?: unknown; code?: unknown };
  return {
    ...(typeof status === "number" ? { status } : {}),
    ...(typeof code === "string" ? { code } : {}),
  };
}

export class Session {
  readonly id: string;
  readonly model: string;
  readonly cwd: string;
  readonly #client: ModelClient;
  readonly #instructions: string;
  readonly #tools: Map<string, Tool>;
  readonly #maxSteps: number;
  readonly #maxRetries: number;
  readonly #retryDelay: (error: unknown, attempt: number) => number;
  readonly #history: HistoryItem[] = [];
  readonly #usage: Usage = emptyUsage();
  readonly #files = new FileTracker();
  readonly #changes: ChangeLog;
  readonly #processes = new ProcessManager();
  readonly #shell: ShellInfo | undefined;
  readonly #search: SearchFn | undefined;
  readonly #store: SessionStore | undefined;
  readonly #outputDir: string | undefined;
  #cost = 0;
  #turn = 0;
  #title = "";
  #storeError: string | null = null;
  #storeErrorShown = false;
  #pending: TurnState | null = null;
  // Items of the turn that is running
  #current: HistoryItem[] | null = null;
  // Size the API reported after the last call, and how many items it covered
  #mark: { tokens: number; items: number } | null = null;
  // Outputs by call id, so a call never runs twice
  readonly #outputs = new Map<string, string>();

  constructor(options: SessionOptions) {
    this.id = options.id ?? randomUUID();
    this.model = options.model;
    this.cwd = options.cwd;
    this.#client = options.client;
    this.#instructions = options.instructions;
    this.#tools = new Map((options.tools ?? []).map((tool) => [tool.name, tool]));
    this.#maxSteps = options.maxSteps ?? DEFAULT_MAX_STEPS;
    this.#maxRetries = options.maxRetries ?? MAX_RETRIES;
    this.#retryDelay = options.retryDelay ?? retryDelayMs;
    this.#shell = options.shell;
    this.#search = options.search;
    this.#store = options.store;
    this.#outputDir = options.outputDir;
    this.#changes = new ChangeLog(
      (change) => this.#save((store) => store.saveFileChange(this.id, change)),
      options.resume?.fileChanges,
    );
    for (const turn of options.resume?.commandTurns ?? []) this.#changes.noteCommand(turn);
    if (options.resume) {
      this.#history.push(...options.resume.history);
      this.#turn = options.resume.turns;
      this.#title = options.resume.title;
      addUsage(this.#usage, options.resume.usage);
      this.#cost = options.resume.cost;
      for (const item of options.resume.history) {
        const {
          type,
          call_id: id,
          output,
        } = item as { type?: string; call_id?: unknown; output?: unknown };
        if (
          type === "function_call_output" &&
          typeof id === "string" &&
          typeof output === "string"
        ) {
          this.#outputs.set(id, output);
        }
      }
    }
  }

  // A broken store must never break the conversation
  #save(write: (store: SessionStore) => void): void {
    if (!this.#store || this.#storeError) return;
    try {
      write(this.#store);
    } catch (error) {
      this.#storeError = errorMessage(error);
    }
  }

  #saveItems(turn: number, items: HistoryItem[]): void {
    if (items.length === 0) return;
    const info = { id: this.id, cwd: this.cwd, model: this.model, title: this.#title };
    this.#save((store) => store.saveItems(info, turn, items));
  }

  #endTurn(turn: number, status: TurnStatus, usage: Usage, cost: number): void {
    this.#save((store) => store.endTurn(this.id, turn, status, usage, cost));
  }

  *#storeWarning(): Generator<AgentEvent> {
    if (!this.#storeError || this.#storeErrorShown) return;
    this.#storeErrorShown = true;
    yield {
      type: "warning",
      message: `This session is no longer being saved: ${this.#storeError}`,
    };
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

  // Encrypted reasoning only works with the account that made it
  forgetReasoning(): void {
    const keep = (item: HistoryItem) => (item as { type?: string }).type !== "reasoning";
    const kept = this.#history.filter(keep);
    this.#history.splice(0, this.#history.length, ...kept);
    if (this.#pending) this.#pending.items = this.#pending.items.filter(keep);
  }

  // How full the context is, exact right after a model call
  context(): ContextUsage {
    const items = [...this.#history, ...(this.#current ?? this.#pending?.items ?? [])];
    const specs = [...this.#tools.values()].map(({ name, description, parameters }) => ({
      name,
      description,
      parameters,
    }));
    const mark = this.#mark && items.length >= this.#mark.items ? this.#mark : null;
    if (!mark) {
      const parts = contextParts(this.#instructions, specs, items, null);
      const tokens = Object.values(parts).reduce((sum, part) => sum + part, 0);
      return { tokens, limit: CONTEXT_LIMIT, estimated: true, parts };
    }
    const added = items.slice(mark.items);
    const tokens = mark.tokens + estimateItems(added);
    return {
      tokens,
      limit: CONTEXT_LIMIT,
      estimated: added.length > 0,
      parts: contextParts(this.#instructions, specs, items, tokens),
    };
  }

  // A failed turn that retry() can pick up
  get canRetry(): boolean {
    return this.#pending !== null;
  }

  // Stop background processes we started
  async dispose(): Promise<void> {
    await this.#processes.killAll();
  }

  // Run one user turn, looping over tools
  async *send(text: string, signal?: AbortSignal): AsyncGenerator<AgentEvent> {
    // A failed turn the user moved on from still happened
    if (this.#pending) this.#keepFailedTurn();
    const turn = ++this.#turn;
    if (!this.#title) this.#title = text.trim().slice(0, 120);
    const state: TurnState = {
      turn,
      items: [{ role: "user", content: text }],
      usage: emptyUsage(),
      cost: 0,
      lastCall: emptyUsage(),
    };
    this.#saveItems(turn, state.items);
    yield* this.#run(state, signal);
  }

  // Continue the failed turn from its last finished step
  async *retry(signal?: AbortSignal): AsyncGenerator<AgentEvent> {
    const state = this.#pending;
    if (!state) {
      yield { type: "error", message: "There is no failed reply to continue." };
      return;
    }
    this.#pending = null;
    const open = openCallOutputs(state.items, ERROR_TOOL_OUTPUT);
    state.items.push(...open);
    this.#saveItems(state.turn, open);
    yield* this.#run(state, signal);
  }

  #keepFailedTurn(): void {
    const state = this.#pending!;
    this.#pending = null;
    const closing = closeTurn(state.items, ERROR_TOOL_OUTPUT, ERROR_NOTE);
    this.#saveItems(state.turn, closing);
    this.#history.push(...state.items, ...closing);
  }

  async *#run(state: TurnState, signal?: AbortSignal): AsyncGenerator<AgentEvent> {
    this.#current = state.items;
    try {
      yield* this.#steps(state, signal);
    } finally {
      this.#current = null;
    }
  }

  async *#steps(state: TurnState, signal?: AbortSignal): AsyncGenerator<AgentEvent> {
    const { turn, items: turnItems } = state;
    const ctx: ToolContext = {
      cwd: this.cwd,
      signal: signal ?? new AbortController().signal,
      files: this.#files,
      shell: this.#shell,
      processes: this.#processes,
      search: this.#search,
      changes: this.#changes,
      outputDir: this.#outputDir,
    };
    const first = turnItems[0] as { content?: unknown } | undefined;
    this.#changes.begin(turn, typeof first?.content === "string" ? first.content : "");
    const toolSpecs = [...this.#tools.values()].map(({ name, description, parameters }) => ({
      name,
      description,
      parameters,
    }));

    try {
      for (let step = 1; ; step++) {
        if (step > this.#maxSteps) {
          this.#history.push(...turnItems);
          this.#endTurn(turn, "done", state.usage, state.cost);
          yield* this.#storeWarning();
          yield {
            type: "error",
            message: `Stopped after ${this.#maxSteps} steps in one turn. Send "continue" to keep going.`,
          };
          return;
        }

        const output = yield* this.#callModel(state, toolSpecs, signal);
        turnItems.push(...output);
        this.#mark = {
          tokens: state.lastCall.inputTokens + state.lastCall.outputTokens,
          items: this.#history.length + turnItems.length,
        };
        this.#saveItems(turn, output);
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
          if (call.name === "bash") this.#changes.noteCommand(turn);
          // A call id that already ran never runs twice
          const earlier = this.#outputs.get(call.call_id);
          const result: ToolResult =
            earlier !== undefined
              ? { output: earlier, summary: "Already ran, reused the earlier result" }
              : await this.#runTool(call, ctx);
          const outputItem: HistoryItem = {
            type: "function_call_output",
            call_id: call.call_id,
            output: earlier ?? (await this.#shorten(call.call_id, result.output)),
          };
          this.#outputs.set(call.call_id, outputItem.output as string);
          turnItems.push(outputItem);
          const view: ToolView = {
            callId: call.call_id,
            name: call.name,
            summary: result.summary ?? (result.isError ? result.output : "done"),
            isError: result.isError ?? false,
            durationMs: Date.now() - started,
            diff: result.diff,
            preview: result.preview,
          };
          this.#saveItems(turn, [outputItem]);
          this.#save((store) => store.saveToolView(this.id, turn, view));
          const { callId, ...shown } = view;
          yield { type: "tool_call_end", id: callId, ...shown };
        }
      }

      this.#history.push(...turnItems);
      this.#endTurn(turn, "done", state.usage, state.cost);
      yield* this.#storeWarning();
      yield { type: "turn_complete", usage: state.usage, cost: state.cost };
    } catch (error) {
      if (signal?.aborted) {
        // Keep what already happened so the model knows about it
        const closing = closeTurn(turnItems, STOPPED_TOOL_OUTPUT, STOPPED_NOTE);
        turnItems.push(...closing);
        this.#saveItems(turn, closing);
        this.#history.push(...turnItems);
        this.#endTurn(turn, "cancelled", state.usage, state.cost);
        yield* this.#storeWarning();
        yield { type: "turn_cancelled" };
        return;
      }
      // Kept aside: retry() continues it, the next message keeps it in history
      this.#pending = state;
      this.#endTurn(turn, "failed", state.usage, state.cost);
      yield* this.#storeWarning();
      const message = isNetworkError(error) ? CONNECTION_FAILED : errorMessage(error);
      yield { type: "error", message, ...errorDetails(error) };
    }
  }

  // One model step, retried on network and server errors
  async *#callModel(
    state: TurnState,
    tools: ToolSpec[],
    signal?: AbortSignal,
  ): AsyncGenerator<AgentEvent, HistoryItem[]> {
    for (let attempt = 1; ; attempt++) {
      let streamed = false;
      try {
        let output: HistoryItem[] | undefined;
        const events = this.#client.stream(
          {
            model: this.model,
            instructions: this.#instructions,
            input: [...this.#history, ...state.items],
            tools: tools.length > 0 ? tools : undefined,
            promptCacheKey: this.id,
          },
          signal,
        );
        for await (const event of events) {
          if (event.type === "text_delta") {
            streamed = true;
            yield { type: "text_delta", text: event.text };
          } else {
            output = event.output;
            state.lastCall = event.usage;
            const cost = costOf(this.model, event.usage);
            addUsage(state.usage, event.usage);
            addUsage(this.#usage, event.usage);
            state.cost += cost;
            this.#cost += cost;
          }
        }
        if (!output) throw new ConnectionLostError("The reply ended before it finished.");
        return output;
      } catch (error) {
        if (signal?.aborted || attempt > this.#maxRetries || !isRetryable(error)) throw error;
        const delayMs = this.#retryDelay(error, attempt);
        yield {
          type: "retrying",
          attempt,
          maxRetries: this.#maxRetries,
          delayMs,
          reason: retryReason(error),
          restarted: streamed,
        };
        await sleep(delayMs, signal);
      }
    }
  }

  // Long output: save it whole, show the start and end
  async #shorten(callId: string, output: string): Promise<string> {
    if (output.length <= MAX_TOOL_OUTPUT) return output;
    let savedAt: string | null = null;
    if (this.#outputDir) {
      const folder = join(this.#outputDir, this.id);
      const file = join(folder, `${callId.replace(/[^\w-]/g, "_")}.txt`);
      try {
        await mkdir(folder, { recursive: true });
        await writeFile(file, output);
        savedAt = file;
      } catch {
        // Not saved: the model is told the middle is gone
      }
    }
    return truncateOutput(output, MAX_TOOL_OUTPUT, savedAt);
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
