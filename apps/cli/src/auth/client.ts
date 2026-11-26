import type { ModelClient, ModelEvent, ModelRequest } from "@nimbus/harness";

// Keeps one client for the session while the login token changes underneath
export class SwitchableModelClient implements ModelClient {
  #inner: ModelClient | null = null;
  readonly #make: (token: string) => ModelClient;

  constructor(make: (token: string) => ModelClient) {
    this.#make = make;
  }

  setToken(token: string | null): void {
    this.#inner = token ? this.#make(token) : null;
  }

  get hasToken(): boolean {
    return this.#inner !== null;
  }

  async *stream(request: ModelRequest, signal?: AbortSignal): AsyncGenerator<ModelEvent> {
    if (!this.#inner) {
      throw Object.assign(new Error("Not logged in. Run /login."), { status: 401 });
    }
    yield* this.#inner.stream(request, signal);
  }
}
