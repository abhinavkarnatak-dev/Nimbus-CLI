import { randomUUID } from "node:crypto";
import { costOf } from "../cost.js";
import { emptyUsage, type HistoryItem, type ModelClient, type Usage } from "../model/types.js";
import type { AgentEvent } from "./events.js";

export interface SessionOptions {
  client: ModelClient;
  model: string;
  instructions: string;
  id?: string;
}

export class Session {
  readonly id: string;
  readonly model: string;
  readonly #client: ModelClient;
  readonly #instructions: string;
  readonly #history: HistoryItem[] = [];
  readonly #usage: Usage = emptyUsage();
  #cost = 0;

  constructor(options: SessionOptions) {
    this.id = options.id ?? randomUUID();
    this.model = options.model;
    this.#client = options.client;
    this.#instructions = options.instructions;
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

  // Run one user turn
  async *send(text: string, signal?: AbortSignal): AsyncGenerator<AgentEvent> {
    const userItem: HistoryItem = { role: "user", content: text };
    const input = [...this.#history, userItem];

    try {
      let output: HistoryItem[] | undefined;
      let usage: Usage | undefined;

      const events = this.#client.stream(
        {
          model: this.model,
          instructions: this.#instructions,
          input,
          promptCacheKey: this.id,
        },
        signal,
      );
      for await (const event of events) {
        if (event.type === "text_delta") {
          yield { type: "text_delta", text: event.text };
        } else {
          output = event.output;
          usage = event.usage;
        }
      }
      if (!output || !usage) throw new Error("Model stream ended without completing");

      this.#history.push(userItem, ...output);
      const cost = costOf(this.model, usage);
      this.#addUsage(usage, cost);
      yield { type: "turn_complete", usage, cost };
    } catch (error) {
      if (signal?.aborted) {
        yield { type: "turn_cancelled" };
        return;
      }
      yield { type: "error", message: error instanceof Error ? error.message : String(error) };
    }
  }

  #addUsage(usage: Usage, cost: number): void {
    this.#usage.inputTokens += usage.inputTokens;
    this.#usage.cachedTokens += usage.cachedTokens;
    this.#usage.outputTokens += usage.outputTokens;
    this.#cost += cost;
  }
}
