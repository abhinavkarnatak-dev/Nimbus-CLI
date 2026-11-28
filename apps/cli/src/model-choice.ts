import { DEFAULT_MODEL, effortFor, modelInfo, type ReasoningEffort } from "@nimbus/harness";
import type { SettingsStore } from "./settings.js";

// The model and reasoning level, saved for next time
export class ModelChoice {
  #model: string;
  #effort: ReasoningEffort;
  readonly #settings: SettingsStore;

  constructor(settings: SettingsStore) {
    this.#settings = settings;
    const saved = settings.load();
    this.#model = saved.model && modelInfo(saved.model) ? saved.model : DEFAULT_MODEL;
    this.#effort = effortFor(this.#model, saved.effort);
  }

  get model(): string {
    return this.#model;
  }

  get effort(): ReasoningEffort {
    return this.#effort;
  }

  set(model: string, effort: ReasoningEffort): void {
    this.#model = model;
    this.#effort = effortFor(model, effort);
    this.#settings.save({ ...this.#settings.load(), model, effort: this.#effort });
  }
}
