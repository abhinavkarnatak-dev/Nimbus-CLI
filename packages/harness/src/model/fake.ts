import type { HistoryItem, ModelClient, ModelEvent, ModelRequest, Usage } from "./types.js";

export interface FakeToolCall {
  name: string;
  args: unknown;
}

export type FakeTurn =
  | { text: string; usage?: Partial<Usage> }
  | { toolCalls: FakeToolCall[]; text?: string; usage?: Partial<Usage> }
  | { error: string; status?: number; code?: string; partialText?: string };

export class FakeModelClient implements ModelClient {
  readonly requests: ModelRequest[] = [];
  readonly #turns: FakeTurn[];
  #callCount = 0;

  constructor(turns: FakeTurn[]) {
    this.#turns = [...turns];
  }

  // Replay scripted turns, word by word
  async *stream(request: ModelRequest, signal?: AbortSignal): AsyncGenerator<ModelEvent> {
    this.requests.push(structuredClone(request));
    const turn = this.#turns.shift();
    if (!turn) throw new Error("FakeModelClient has no more turns");
    if ("error" in turn) {
      if (turn.partialText) yield { type: "text_delta", text: turn.partialText };
      throw Object.assign(new Error(turn.error), { status: turn.status, code: turn.code });
    }

    const text = turn.text ?? "";
    for (const word of text.split(/(?<= )/).filter(Boolean)) {
      signal?.throwIfAborted();
      await Promise.resolve();
      yield { type: "text_delta", text: word };
    }
    signal?.throwIfAborted();

    const output: HistoryItem[] = [];
    if (text) output.push({ role: "assistant", content: text });
    if ("toolCalls" in turn) {
      for (const call of turn.toolCalls) {
        this.#callCount++;
        output.push({
          type: "function_call",
          call_id: `call_${this.#callCount}`,
          name: call.name,
          arguments: typeof call.args === "string" ? call.args : JSON.stringify(call.args),
        });
      }
    }

    yield {
      type: "completed",
      output,
      usage: { inputTokens: 0, cachedTokens: 0, outputTokens: 0, ...turn.usage },
    };
  }
}
