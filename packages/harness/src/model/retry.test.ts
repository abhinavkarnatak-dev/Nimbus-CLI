import { describe, expect, it } from "vitest";
import {
  ConnectionLostError,
  isNetworkError,
  isRetryable,
  retryDelayMs,
  retryReason,
  sleep,
} from "./retry.js";

const withStatus = (status: number, extra: object = {}) =>
  Object.assign(new Error(`status ${status}`), { status, ...extra });

describe("isRetryable", () => {
  it("retries server trouble and rate limits", () => {
    for (const status of [408, 409, 429, 500, 502, 503, 504]) {
      expect(isRetryable(withStatus(status))).toBe(true);
    }
  });

  it("never retries errors about the request, the login or money", () => {
    for (const status of [400, 401, 402, 403, 404, 413, 422]) {
      expect(isRetryable(withStatus(status))).toBe(false);
    }
    expect(isRetryable(withStatus(429, { code: "insufficient_quota" }))).toBe(false);
  });

  it("obeys x-should-retry from the server", () => {
    const headers = new Headers({ "x-should-retry": "false" });
    expect(isRetryable(withStatus(503, { headers }))).toBe(false);
    expect(isRetryable(withStatus(400, { headers: { "x-should-retry": "true" } }))).toBe(true);
  });

  it("retries dropped connections, including mid-stream ones", () => {
    const reset = Object.assign(new Error("socket"), { code: "ECONNRESET" });
    expect(isRetryable(new TypeError("fetch failed", { cause: reset }))).toBe(true);
    expect(isRetryable(new TypeError("terminated"))).toBe(true);
    expect(isRetryable(new ConnectionLostError("stalled"))).toBe(true);
    expect(isRetryable(Object.assign(new Error("boom"), { code: "server_error" }))).toBe(true);
  });

  it("does not retry aborts or plain bugs", () => {
    expect(isRetryable(new DOMException("stopped", "AbortError"))).toBe(false);
    expect(isRetryable(new Error("boom"))).toBe(false);
    expect(isRetryable(new TypeError("x is not a function"))).toBe(false);
    expect(isRetryable("nope")).toBe(false);
  });
});

describe("retryDelayMs", () => {
  it("waits 10s before every retry", () => {
    expect([1, 2, 3, 4, 5].map(() => retryDelayMs(new Error("x")))).toEqual([
      10000, 10000, 10000, 10000, 10000,
    ]);
  });

  it("waits longer only when the server asks for longer", () => {
    const asks = (value: string) =>
      withStatus(429, { headers: new Headers({ "retry-after": value }) });
    expect(retryDelayMs(asks("20"))).toBe(20000);
    expect(retryDelayMs(asks("2"))).toBe(10000);
    expect(retryDelayMs(asks("600"))).toBe(10000);
    expect(retryDelayMs(withStatus(429, { headers: { "retry-after-ms": "15000" } }))).toBe(15000);
  });
});

describe("retryReason", () => {
  it("names what went wrong in a few words", () => {
    expect(retryReason(withStatus(429))).toBe("Server busy");
    expect(retryReason(withStatus(502))).toBe("Server error");
    expect(retryReason(new TypeError("fetch failed"))).toBe("Connection lost");
  });
});

describe("sleep", () => {
  it("ends early when the signal aborts", async () => {
    const controller = new AbortController();
    const waiting = sleep(60_000, controller.signal);
    controller.abort(new Error("stopped"));
    await expect(waiting).rejects.toThrow("stopped");
  });

  it("finds network errors in the cause chain", () => {
    const deep = new Error("a", { cause: new Error("b", { cause: { code: "ENOTFOUND" } }) });
    expect(isNetworkError(deep)).toBe(true);
  });
});
