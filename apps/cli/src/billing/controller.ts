import type { SecretStore } from "../auth/secrets.js";
import type { Route, SettingsStore } from "../settings.js";
import { maskKey, verifyOpenAIKey, type KeyCheck } from "./own-key.js";
import type { RoutingModelClient } from "./router.js";

export interface BillingState {
  route: Route;
  hasKey: boolean;
  keyHint: string | null;
}

export interface BillingOptions {
  keys: SecretStore;
  settings: SettingsStore;
  client: RoutingModelClient;
  model: string;
  fetchFn?: typeof fetch;
}

// Which credit pays for model calls: Nimbus or the user's own OpenAI key
export class BillingController {
  readonly #options: BillingOptions;
  #key: string | null;

  constructor(options: BillingOptions) {
    this.#options = options;
    this.#key = options.keys.load();
    options.client.setKey(this.#key);
    const wanted = options.settings.load().use;
    options.client.route = wanted === "key" && this.#key ? "key" : "nimbus";
  }

  get state(): BillingState {
    return {
      route: this.#options.client.route,
      hasKey: this.#key !== null,
      keyHint: this.#key ? maskKey(this.#key) : null,
    };
  }

  // Check, save and start using a key; a bad key leaves the old one in place
  async setKey(key: string): Promise<KeyCheck> {
    const trimmed = key.trim();
    const check = await verifyOpenAIKey(trimmed, this.#options.model, this.#options.fetchFn);
    if (!check.ok) return check;
    this.#options.keys.save(trimmed);
    this.#key = trimmed;
    this.#options.client.setKey(trimmed);
    this.use("key");
    return check;
  }

  removeKey(): void {
    this.#options.keys.clear();
    this.#key = null;
    this.#options.client.setKey(null);
    this.use("nimbus");
  }

  // Returns true when the route actually changed
  use(route: Route): boolean {
    if (route === "key" && !this.#key) return false;
    const changed = this.#options.client.route !== route;
    this.#options.client.route = route;
    this.#options.settings.save({ ...this.#options.settings.load(), use: route });
    return changed;
  }
}
