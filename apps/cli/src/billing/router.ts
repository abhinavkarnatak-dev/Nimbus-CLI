import type { ModelClient, ModelEvent, ModelRequest } from "@nimbus/harness";
import type { Route } from "../settings.js";

// One client for the session, sending each call to Nimbus or to the user's own key
export class RoutingModelClient implements ModelClient {
  route: Route = "nimbus";
  #own: ModelClient | null = null;
  readonly #nimbus: ModelClient;
  readonly #makeOwn: (key: string) => ModelClient;

  constructor(nimbus: ModelClient, makeOwn: (key: string) => ModelClient) {
    this.#nimbus = nimbus;
    this.#makeOwn = makeOwn;
  }

  setKey(key: string | null): void {
    this.#own = key ? this.#makeOwn(key) : null;
  }

  async *stream(request: ModelRequest, signal?: AbortSignal): AsyncGenerator<ModelEvent> {
    if (this.route === "key") {
      if (!this.#own) throw new Error("No OpenAI key saved. Add one with /key.");
      yield* this.#own.stream(request, signal);
      return;
    }
    yield* this.#nimbus.stream(request, signal);
  }
}
