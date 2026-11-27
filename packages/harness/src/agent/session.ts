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
import {
  closeTurn,
  ERROR_NOTE,
  ERROR_TOOL_OUTPUT,
  openCallOutputs,
  type ResumeState,
} from "./resume.js";
import type { SessionStore, ToolView, TurnStatus } from "./store.js";

export const DEFAULT_MAX_STEPS = 25;

// Seen by the model after a turn the user stopped
export const STOPPED_NOTE = "[The user stopped this reply before it finished.]";
export const STOPPED_TOOL_OUTPUT =
  "Stopped by the user before this finished. It may have partly run, so check before running it again.";

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
}

interface TurnState {
  turn: number;
  items: HistoryItem[];
  usage: Usage;
  cost: number;
}

function addUsage(total: Usage, usage: Usage): void {
  total.inputTokens += usage.inputTokens;
  total.cachedTokens += usage.cachedTokens;
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
  readonly #history: HistoryItem[] = [];
  readonly #usage: Usage = emptyUsage();
  readonly #files = new FileTracker();
  readonly #processes = new ProcessManager();
  readonly #shell: ShellInfo | undefined;
  readonly #search: SearchFn | undefined;
  readonly #store: SessionStore | undefined;
  #cost = 0;
  #turn = 0;
  #title = "";
  #storeError: string | null = null;
  #storeErrorShown = false;
  #pending: TurnState | null = null;
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
    this.#shell = options.shell;
    this.#search = options.search;
    this.#store = options.store;
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
    const { turn, items: turnItems } = state;
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
          this.#endTurn(turn, "done", state.usage, state.cost);
          yield* this.#storeWarning();
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
            addUsage(state.usage, event.usage);
            addUsage(this.#usage, event.usage);
            state.cost += cost;
            this.#cost += cost;
          }
        }
        if (!output) throw new Error("Model stream ended without completing");

        turnItems.push(...output);
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
          // A call id that already ran never runs twice
          const earlier = this.#outputs.get(call.call_id);
          const result: ToolResult =
            earlier !== undefined
              ? { output: earlier, summary: "Already ran, reused the earlier result" }
              : await this.#runTool(call, ctx);
          const outputItem: HistoryItem = {
            type: "function_call_output",
            call_id: call.call_id,
            output: earlier ?? truncateOutput(result.output),
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
      yield { type: "error", message: errorMessage(error), ...errorDetails(error) };
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
