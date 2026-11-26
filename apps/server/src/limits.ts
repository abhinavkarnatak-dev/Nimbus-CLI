import type { Db } from "./db/client.js";
import { totalSpent } from "./db/ledger.js";

// Per user: requests at the same time and per minute, in memory
export class UserLimits {
  readonly #inFlight = new Map<string, number>();
  readonly #windows = new Map<string, { start: number; count: number }>();

  constructor(
    readonly maxConcurrent: number,
    readonly perMinute: number,
    private readonly now: () => number = Date.now,
  ) {}

  // A release function, or the reason the request must wait
  acquire(userId: string): { release: () => void } | { refused: "concurrency" | "rate" } {
    const running = this.#inFlight.get(userId) ?? 0;
    if (running >= this.maxConcurrent) return { refused: "concurrency" };

    const time = this.now();
    const window = this.#windows.get(userId);
    if (!window || time - window.start >= 60_000) {
      this.#windows.set(userId, { start: time, count: 1 });
    } else if (window.count >= this.perMinute) {
      return { refused: "rate" };
    } else {
      window.count++;
    }

    this.#inFlight.set(userId, running + 1);
    let released = false;
    return {
      release: () => {
        if (released) return;
        released = true;
        const left = (this.#inFlight.get(userId) ?? 1) - 1;
        if (left <= 0) this.#inFlight.delete(userId);
        else this.#inFlight.set(userId, left);
      },
    };
  }
}

// Total spend of all users, kept fresh from the database
export class SpendTracker {
  #total = 0;
  #loadedAt = 0;

  constructor(
    private readonly db: Db,
    private readonly refreshMs = 60_000,
  ) {}

  get total(): number {
    return this.#total;
  }

  add(cost: number): void {
    this.#total += cost;
  }

  async refreshIfStale(): Promise<void> {
    if (Date.now() - this.#loadedAt < this.refreshMs) return;
    this.#total = await totalSpent(this.db);
    this.#loadedAt = Date.now();
  }
}
