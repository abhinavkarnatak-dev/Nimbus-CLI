import type { ModelClient, ModelEvent, ModelRequest, Usage } from "./types.js";

export type FakeTurn = { text: string; usage?: Partial<Usage> } | { error: string };

export class FakeModelClient implements ModelClient {
  readonly requests: ModelRequest[] = [];
  readonly #turns: FakeTurn[];

  constructor(turns: FakeTurn[]) {
    this.#turns = [...turns];
  }

  // Replay scripted turns, word by word
  async *stream(request: ModelRequest, signal?: AbortSignal): AsyncGenerator<ModelEvent> {
    this.requests.push(structuredClone(request));
    const turn = this.#turns.shift();
    if (!turn) throw new Error("FakeModelClient has no more turns");
    if ("error" in turn) throw new Error(turn.error);

    for (const word of turn.text.split(/(?<= )/)) {
      signal?.throwIfAborted();
      await Promise.resolve();
      yield { type: "text_delta", text: word };
    }
    signal?.throwIfAborted();

    yield {
      type: "completed",
      output: [{ role: "assistant", content: turn.text }],
      usage: { inputTokens: 0, cachedTokens: 0, outputTokens: 0, ...turn.usage },
    };
  }
}
