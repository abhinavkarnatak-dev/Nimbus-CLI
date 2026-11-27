import { describe, expect, it } from "vitest";
import {
  applyEvent,
  LOOP_STOPPED,
  RESTARTED_NOTICE,
  settle,
  type Item,
} from "../src/ui/transcript.js";

describe("transcript", () => {
  it("joins text deltas into one assistant item", () => {
    let items: Item[] = [];
    items = applyEvent(items, { type: "text_delta", text: "Hel" });
    items = applyEvent(items, { type: "text_delta", text: "lo" });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: "assistant", text: "Hello" });
  });

  it("marks a tool done by its call id", () => {
    let items: Item[] = [];
    items = applyEvent(items, { type: "tool_call_start", id: "c1", name: "bash", args: "{}" }, 0);
    items = applyEvent(items, { type: "tool_call_start", id: "c2", name: "glob", args: "{}" }, 0);
    items = applyEvent(items, {
      type: "tool_call_end",
      id: "c2",
      name: "glob",
      summary: "Found 3 files",
      isError: false,
      durationMs: 5,
    });
    expect(items.map((item) => (item.kind === "tool" ? item.status : null))).toEqual([
      "running",
      "done",
    ]);
  });

  it("keeps order: a finished tool waits behind a running one", () => {
    let items: Item[] = [];
    items = applyEvent(items, { type: "tool_call_start", id: "c1", name: "bash", args: "{}" }, 0);
    items = applyEvent(items, { type: "tool_call_start", id: "c2", name: "glob", args: "{}" }, 0);
    items = applyEvent(items, {
      type: "tool_call_end",
      id: "c2",
      name: "glob",
      summary: "ok",
      isError: false,
      durationMs: 1,
    });
    const { done, live } = settle(items);
    expect(done).toHaveLength(0);
    expect(live).toHaveLength(2);
  });

  it("moves finished paragraphs out of the live area", () => {
    const items = applyEvent([], { type: "text_delta", text: "First part.\n\nSecond" });
    const { done, live } = settle(items);
    expect(done).toMatchObject([{ kind: "assistant", text: "First part." }]);
    expect(live).toMatchObject([{ kind: "assistant", text: "Second", continued: true }]);
  });

  it("never splits inside a code block", () => {
    const text = "Here:\n```js\nconst a = 1;\n\nconst b = 2;";
    const { done, live } = settle(applyEvent([], { type: "text_delta", text }));
    expect(done).toHaveLength(0);
    expect(live[0]).toMatchObject({ text });
  });

  it("starts a fresh reply below a half-shown one after a dropped connection", () => {
    const retry = { attempt: 1, maxRetries: 5, delayMs: 1000, reason: "Connection lost" };
    let items: Item[] = [];
    items = applyEvent(items, { type: "retrying", ...retry, restarted: false });
    expect(items).toEqual([]);
    items = applyEvent(items, { type: "text_delta", text: "Hel" });
    items = applyEvent(items, { type: "retrying", ...retry, restarted: true });
    items = applyEvent(items, { type: "text_delta", text: "Hello" });
    expect(items.map((item) => item.kind)).toEqual(["assistant", "notice", "assistant"]);
    expect(items[1]).toMatchObject({ text: RESTARTED_NOTICE, tone: "info" });
    expect(items[2]).toMatchObject({ text: "Hello" });
  });

  it("says when a loop was stopped", () => {
    const items = applyEvent([], { type: "loop_stopped" });
    expect(items[0]).toMatchObject({ kind: "notice", text: LOOP_STOPPED, tone: "error" });
  });

  it("adds a notice when the turn is stopped", () => {
    const items = applyEvent([], { type: "turn_cancelled" });
    expect(items[0]).toMatchObject({ kind: "notice", tone: "info" });
  });
});
