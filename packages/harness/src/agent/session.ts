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
import {
  COMPACT_AT,
  compactRequest,
  MIN_COMPACT_TOKENS,
  PRUNE_ENOUGH,
  pruneTargets,
  removedOutputNote,
  replyText,
  summaryItem,
} from "./compact.js";
import { DECLINED_NOTE, SKIPPED_NOTE, type ApproveFn } from "./approval.js";
import { TurnChecks, VERIFY_REMINDER } from "./checks.js";
import { contextParts, estimateItems, estimateTokens, type ContextUsage } from "./context.js";
import { todosFrom, type Todo } from "../tools/todos.js";
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

// Seen by the model when the user stopped at the budget pause
export const BUDGET_NOTE =
  "[This reply was paused before it finished because the session reached the spending limit the user set with /budget, and the user chose not to continue it. Anything done before the pause did happen, so check before repeating it.]";

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
  // Spending limit in USD; the turn pauses before going over
  budget?: number | null;
  // Asked before tools that change files or run commands
  approve?: ApproveFn;
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
  // Stopped before a model call because of the budget
  paused?: boolean;
  // Loops and unchecked code changes in this turn
  checks: TurnChecks;
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
  #budget: number | null;
  readonly #approve: ApproveFn | undefined;
  #todos: Todo[] = [];
  #cost = 0;
  #turn = 0;
  #title = "";
  #storeError: string | null = null;
  #storeErrorShown = false;
  #pending: TurnState | null = null;
  // Items of the turn that is running
  #current: HistoryItem[] | null = null;
  // Size the API reported after the last call, and how many items it covered
  #mark: { tokens: number; items: number; exact: boolean } | null = null;
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
    this.#budget = options.budget ?? null;
    this.#approve = options.approve;
    this.#todos = todosFrom(options.resume?.history ?? []);
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
      estimated: added.length > 0 || !mark.exact,
      parts: contextParts(this.#instructions, specs, items, tokens),
    };
  }

  // The model's latest checklist
  get todos(): readonly Todo[] {
    return this.#todos;
  }

  get budget(): number | null {
    return this.#budget;
  }

  setBudget(usd: number | null): void {
    this.#budget = usd;
  }

  // Shrink the conversation now, on /compact
  async *compact(focus?: string, signal?: AbortSignal): AsyncGenerator<AgentEvent> {
    if (this.#pending) this.#keepFailedTurn();
    if (this.#history.length === 0) {
      yield { type: "error", message: "There is nothing to compact yet." };
      return;
    }
    // A summary of a short chat is longer than the chat itself
    const size = estimateItems(this.#history);
    if (size < MIN_COMPACT_TOKENS) {
      yield {
        type: "notice",
        message: `The conversation is still short (about ${size.toLocaleString("en-US")} tokens), so there is nothing worth compacting yet.`,
      };
      return;
    }
    const state = this.#newState(this.#turn + 1, []);
    try {
      yield* this.#compactNow(state, { focus, manual: true }, signal);
    } catch (error) {
      if (signal?.aborted) {
        yield { type: "turn_cancelled" };
        return;
      }
      yield {
        type: "error",
        message: `Could not compact the conversation: ${errorMessage(error)}`,
      };
    }
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
    const state = this.#newState(turn, [{ role: "user", content: text }]);
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

  #newState(turn: number, items: HistoryItem[]): TurnState {
    return {
      turn,
      items,
      usage: emptyUsage(),
      cost: 0,
      lastCall: emptyUsage(),
      checks: new TurnChecks(),
    };
  }

  #keepFailedTurn(): void {
    const state = this.#pending!;
    this.#pending = null;
    const closing = closeTurn(
      state.items,
      ERROR_TOOL_OUTPUT,
      state.paused ? BUDGET_NOTE : ERROR_NOTE,
    );
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
    const toolSpecs = this.#toolSpecs();

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

        // Pause before spending past the user's limit
        if (this.#budget !== null && this.#cost >= this.#budget) {
          state.paused = true;
          this.#pending = state;
          this.#endTurn(turn, "failed", state.usage, state.cost);
          yield* this.#storeWarning();
          yield { type: "budget_reached", spent: this.#cost, budget: this.#budget };
          return;
        }
        state.paused = false;
        const context = this.context();
        if (context.tokens >= context.limit * COMPACT_AT) {
          yield* this.#compactNow(state, { manual: false }, signal);
        }

        const output = yield* this.#callModel(state, toolSpecs, signal);
        turnItems.push(...output);
        this.#mark = {
          tokens: state.lastCall.inputTokens + state.lastCall.outputTokens,
          items: this.#history.length + turnItems.length,
          exact: true,
        };
        this.#saveItems(turn, output);
        const calls = output.filter(isFunctionCall);
        if (calls.length === 0) {
          // Changed code but never ran it: one reminder per turn
          if (state.checks.needsCheck) {
            state.checks.reminded = true;
            const reminder: HistoryItem = { role: "user", content: VERIFY_REMINDER };
            turnItems.push(reminder);
            this.#saveItems(turn, [reminder]);
            yield {
              type: "notice",
              message: "Asked the model to check its changes before finishing.",
            };
            continue;
          }
          break;
        }

        let looping = false;
        let declined = false;

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
          // After a "no", the rest of the step does not run
          const status =
            earlier !== undefined
              ? "reused"
              : declined
                ? "skipped"
                : (await this.#approved(call, ctx))
                  ? "run"
                  : "declined";
          if (status === "declined") declined = true;
          const result: ToolResult =
            status === "reused"
              ? { output: earlier!, summary: "Already ran, reused the earlier result" }
              : status === "declined"
                ? { output: DECLINED_NOTE, summary: "Declined by you", isError: true }
                : status === "skipped"
                  ? { output: SKIPPED_NOTE, summary: "Skipped", isError: true }
                  : await this.#runTool(call, ctx);
          const stopped = status === "declined" || status === "skipped";
          let shown =
            earlier ?? (stopped ? result.output : await this.#shorten(call.call_id, result.output));
          if (earlier === undefined && !stopped) {
            const check = state.checks.record(
              call.name,
              call.arguments,
              shown,
              result.isError ?? false,
            );
            if (check.note) shown = `${shown}\n\n${check.note}`;
            if (check.stop) looping = true;
            if (call.name === "update_todos" && !result.isError) this.#todos = todosFrom([call]);
          }
          const outputItem: HistoryItem = {
            type: "function_call_output",
            call_id: call.call_id,
            output: shown,
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
          const { callId, ...visible } = view;
          yield { type: "tool_call_end", id: callId, ...visible };
        }

        // The user said no: stop and wait for their next message
        if (declined) {
          this.#history.push(...turnItems);
          this.#endTurn(turn, "done", state.usage, state.cost);
          yield* this.#storeWarning();
          yield { type: "declined" };
          return;
        }

        // Same step over and over: stop and let the user steer
        if (looping) {
          this.#history.push(...turnItems);
          this.#endTurn(turn, "done", state.usage, state.cost);
          yield* this.#storeWarning();
          yield { type: "loop_stopped" };
          return;
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

  // Drop old outputs first, summarize only if that is not enough
  async *#compactNow(
    state: TurnState,
    { focus, manual }: { focus?: string; manual: boolean },
    signal?: AbortSignal,
  ): AsyncGenerator<AgentEvent> {
    const before = this.context().tokens;
    const limit = this.context().limit;
    yield { type: "compacting", auto: !manual };

    const pruned = await this.#pruneOutputs(state.items);
    if (pruned.count > 0) {
      this.#adjustMark(pruned.delta, 0);
      this.#save((store) => store.saveCompaction(this.id, state.turn, this.#history));
    }
    const afterPrune = this.context().tokens;
    const canSummarize = this.#history.length > 1 || (this.#history.length === 1 && manual);
    if ((!manual && afterPrune < limit * PRUNE_ENOUGH) || !canSummarize) {
      yield { type: "compacted", before, after: afterPrune, summarized: false };
      return;
    }

    let output: HistoryItem[];
    try {
      output = yield* this.#callModel(state, [...this.#toolSpecs()], signal, {
        input: [...this.#history, { role: "user", content: compactRequest(focus) }],
        toolChoice: "none",
        quiet: true,
      });
    } catch (error) {
      if (signal?.aborted || manual) throw error;
      // The turn goes on without a summary
      yield {
        type: "warning",
        message: `Could not compact the conversation: ${errorMessage(error)}`,
      };
      return;
    }
    const summary = replyText(output);
    if (!summary) {
      if (manual) throw new Error("the model returned an empty summary");
      yield {
        type: "warning",
        message: "Could not compact the conversation: the summary was empty.",
      };
      return;
    }
    // Reasoning has no readable size: take its share from the real total
    const isReasoning = (item: HistoryItem) => (item as { type?: string }).type === "reasoning";
    const reasoningAll = [...this.#history, ...state.items].filter(isReasoning).length;
    const reasoningOld = this.#history.filter(isReasoning).length;
    const removedReasoning = reasoningAll
      ? Math.round((this.context().parts.reasoning * reasoningOld) / reasoningAll)
      : 0;
    const old = this.#history.splice(0, this.#history.length, summaryItem(summary));
    this.#adjustMark(
      estimateItems(this.#history) - estimateItems(old) - removedReasoning,
      this.#history.length - old.length,
    );
    this.#save((store) => store.saveCompaction(this.id, state.turn, this.#history));
    yield* this.#storeWarning();
    yield { type: "compacted", before, after: this.context().tokens, summarized: true };
  }

  // Start from the real size and adjust by what changed
  #adjustMark(tokens: number, items: number): void {
    if (!this.#mark) return;
    this.#mark = {
      tokens: Math.max(0, this.#mark.tokens + tokens),
      items: this.#mark.items + items,
      exact: false,
    };
  }

  // Replace old big tool outputs with a short note
  async #pruneOutputs(current: HistoryItem[]): Promise<{ count: number; delta: number }> {
    const all = [...this.#history, ...current];
    let count = 0;
    let delta = 0;
    for (const target of pruneTargets(all)) {
      const savedAt = await this.#saveOutput(target.callId, target.output, false);
      const item = all[target.index] as { output: string };
      item.output = removedOutputNote(target.tool, target.tokens, savedAt);
      this.#outputs.set(target.callId, item.output);
      delta += estimateTokens(item.output.length) - target.tokens;
      count++;
    }
    return { count, delta };
  }

  // Ask the user before a tool that changes something
  async #approved(call: FunctionCallItem, ctx: ToolContext): Promise<boolean> {
    const tool = this.#tools.get(call.name);
    if (!tool?.needsApproval || !this.#approve) return true;
    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(call.arguments) as Record<string, unknown>;
    } catch {
      // The tool itself reports bad arguments
    }
    const decision = await this.#approve(
      { tool: call.name, args, callId: call.call_id },
      ctx.signal,
    );
    ctx.signal.throwIfAborted();
    return decision === "allow";
  }

  #toolSpecs(): ToolSpec[] {
    return [...this.#tools.values()].map(({ name, description, parameters }) => ({
      name,
      description,
      parameters,
    }));
  }

  // One model step, retried on network and server errors
  async *#callModel(
    state: TurnState,
    tools: ToolSpec[],
    signal?: AbortSignal,
    options: { input?: HistoryItem[]; toolChoice?: "none"; quiet?: boolean } = {},
  ): AsyncGenerator<AgentEvent, HistoryItem[]> {
    for (let attempt = 1; ; attempt++) {
      let streamed = false;
      try {
        let output: HistoryItem[] | undefined;
        const events = this.#client.stream(
          {
            model: this.model,
            instructions: this.#instructions,
            input: options.input ?? [...this.#history, ...state.items],
            tools: tools.length > 0 ? tools : undefined,
            toolChoice: options.toolChoice,
            promptCacheKey: this.id,
          },
          signal,
        );
        for await (const event of events) {
          if (event.type === "text_delta") {
            streamed = true;
            if (!options.quiet) yield { type: "text_delta", text: event.text };
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
          restarted: streamed && !options.quiet,
        };
        await sleep(delayMs, signal);
      }
    }
  }

  // Long output: save it whole, show the start and end
  async #shorten(callId: string, output: string): Promise<string> {
    if (output.length <= MAX_TOOL_OUTPUT) return output;
    const savedAt = await this.#saveOutput(callId, output, true);
    return truncateOutput(output, MAX_TOOL_OUTPUT, savedAt);
  }

  // Full output to a file the model can read later
  async #saveOutput(callId: string, output: string, overwrite: boolean): Promise<string | null> {
    if (!this.#outputDir) return null;
    const folder = join(this.#outputDir, this.id);
    const file = join(folder, `${callId.replace(/[^\w-]/g, "_")}.txt`);
    try {
      await mkdir(folder, { recursive: true });
      // A cut output was saved whole already; keep that copy
      await writeFile(file, output, { flag: overwrite ? "w" : "wx" });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") return null;
    }
    return file;
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
