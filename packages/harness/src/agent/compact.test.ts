import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { FakeModelClient, type FakeTurn } from "../model/fake.js";
import type { HistoryItem } from "../model/types.js";
import { defineTool } from "../tools/types.js";
import { COMPACT_REQUEST, compactRequest, SUMMARY_PREFIX } from "./compact.js";
import type { AgentEvent } from "./events.js";
import { BUDGET_NOTE, Session } from "./session.js";
import { MemorySessionStore } from "./store.js";

async function drain(events: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const all: AgentEvent[] = [];
  for await (const event of events) all.push(event);
  return all;
}

const BIG = "x".repeat(28_000);
let runs = 0;
const big = defineTool({
  name: "big",
  description: "Returns a big output.",
  schema: z.strictObject({}),
  async run() {
    runs++;
    return { output: `${runs}${BIG}` };
  },
});

async function newSession(turns: FakeTurn[], budget?: number) {
  const client = new FakeModelClient(turns);
  const store = new MemorySessionStore();
  const outputDir = await mkdtemp(join(tmpdir(), "nimbus-compact-"));
  const session = new Session({
    client,
    model: "gpt-6-luna",
    instructions: "test prompt",
    cwd: process.cwd(),
    tools: [big],
    id: "s1",
    store,
    outputDir,
    budget,
  });
  return { client, session, store, outputDir };
}

const full = { inputTokens: 230_000, outputTokens: 100 };
const firstText = (item: HistoryItem | undefined) => (item as { content?: string })?.content ?? "";
const outputs = (items: readonly HistoryItem[]) =>
  items.filter((item) => (item as { type?: string }).type === "function_call_output") as {
    output: string;
  }[];

describe("compaction", () => {
  it("summarizes earlier turns automatically near the limit and keeps the cache prefix", async () => {
    const { client, session, store } = await newSession([
      { text: "first answer", usage: full },
      { text: "SUMMARY: user wants a login page", usage: { inputTokens: 230_100 } },
      { text: "second answer" },
    ]);
    await drain(session.send("build a login page"));
    const events = await drain(session.send("now add a logout button"));

    expect(
      events
        .filter((e) => e.type === "text_delta")
        .map((e) => e.type === "text_delta" && e.text)
        .join(""),
    ).toBe("second answer");
    expect(events).toContainEqual({ type: "compacting", auto: true });
    expect(events).toContainEqual(expect.objectContaining({ type: "compacted", summarized: true }));

    const [first, summaryCall, next] = client.requests;
    expect(summaryCall!.toolChoice).toBe("none");
    expect(summaryCall!.tools).toEqual(first!.tools);
    expect(summaryCall!.instructions).toBe(first!.instructions);
    expect(firstText(summaryCall!.input.at(-1))).toBe(COMPACT_REQUEST);
    // The summary call starts with the old history, so the cache still works
    expect(summaryCall!.input.slice(0, first!.input.length)).toEqual(first!.input);

    expect(firstText(next!.input[0])).toContain(SUMMARY_PREFIX);
    expect(firstText(next!.input[0])).toContain("SUMMARY: user wants a login page");
    expect(firstText(next!.input[1])).toBe("now add a logout button");
    expect(next!.input).toHaveLength(2);
    expect(store.compactions.get("s1")).toMatchObject({ turn: 2 });
  });

  it("drops big old tool outputs first and stops there when that is enough", async () => {
    runs = 0;
    // 14 outputs of about 7,000 tokens; dropping 10 of them is enough
    const calls = Array.from({ length: 14 }, () => ({ name: "big", args: {} }));
    const { client, session, outputDir } = await newSession([
      { toolCalls: calls },
      { text: "done", usage: { inputTokens: 218_000, outputTokens: 100 } },
      { text: "fine" },
    ]);
    await drain(session.send("make big outputs"));
    const events = await drain(session.send("next"));
    expect(events).toContainEqual(
      expect.objectContaining({ type: "compacted", summarized: false }),
    );

    const sent = outputs(client.requests[2]!.input);
    expect(sent).toHaveLength(14);
    expect(sent[0]!.output).toMatch(
      /^\[Output removed to save space: this big result \(about 7,001 tokens\) was older and no longer needed in full\. The full output is saved at .+call_1\.txt\. If you need any of it again, search it with grep or read the part you need with read_file instead of running the tool again\.\]$/,
    );
    expect(sent.slice(0, 10).every((item) => item.output.includes("Output removed"))).toBe(true);
    expect(sent.slice(10).every((item) => item.output.endsWith(BIG))).toBe(true);
    expect(await readFile(join(outputDir, "s1", "call_1.txt"), "utf8")).toBe(`1${BIG}`);
  });

  it("says a short chat is not worth compacting", async () => {
    const { client, session } = await newSession([{ text: "short answer" }]);
    await drain(session.send("hello"));
    const events = await drain(session.compact());
    expect(events).toEqual([
      {
        type: "notice",
        message: expect.stringMatching(
          /^The conversation is still short \(about \d+ tokens\), so there is nothing worth compacting yet\.$/,
        ),
      },
    ]);
    expect(client.requests).toHaveLength(1);
  });

  it("compacts on /compact with the user's focus and reports sizes from the real total", async () => {
    const long = "word ".repeat(2000);
    const { client, session } = await newSession([
      { text: long, usage: { inputTokens: 3000, outputTokens: 2600 } },
      { text: "SUMMARY" },
    ]);
    expect(await drain(session.compact())).toEqual([
      { type: "error", message: "There is nothing to compact yet." },
    ]);
    await drain(session.send("hello"));
    const events = await drain(session.compact("keep the login details"));
    const done = events.at(-1);
    expect(done).toMatchObject({ type: "compacted", summarized: true, before: 5600 });
    // About 2,500 tokens of answer replaced by a short summary
    expect(done?.type === "compacted" && done.after).toBeLessThan(3400);
    expect(done?.type === "compacted" && done.after).toBeGreaterThan(3000);
    expect(session.context().estimated).toBe(true);
    expect(firstText(client.requests[1]!.input.at(-1))).toBe(
      compactRequest("keep the login details"),
    );
    expect(firstText(client.requests[1]!.input.at(-1))).toContain(
      "keep every detail\nabout it: keep the login details",
    );
    expect(session.history).toHaveLength(1);
  });

  it("goes on without a summary when the summary call fails", async () => {
    const { session } = await newSession([
      { text: "first", usage: full },
      { error: "bad request", status: 400 },
      { text: "still answered" },
    ]);
    await drain(session.send("one"));
    const events = await drain(session.send("two"));
    expect(events).toContainEqual(expect.objectContaining({ type: "warning" }));
    expect(events.at(-1)?.type).toBe("turn_complete");
  });
});

describe("budget", () => {
  it("pauses before going over and continues the same reply after raising it", async () => {
    runs = 0;
    const pricey = { inputTokens: 100_000, outputTokens: 10_000 };
    const { session } = await newSession(
      [{ toolCalls: [{ name: "big", args: {} }], usage: pricey }, { text: "all done" }],
      0.001,
    );
    const first = await drain(session.send("go"));
    expect(first.at(-1)).toMatchObject({ type: "budget_reached", budget: 0.001 });
    expect(session.canRetry).toBe(true);
    session.setBudget(0.1);
    const rest = await drain(session.retry());
    expect(rest.at(-1)?.type).toBe("turn_complete");
    expect(runs).toBe(1);
  });

  it("tells the model when the user stopped at the pause", async () => {
    const { client, session } = await newSession(
      [{ toolCalls: [{ name: "big", args: {} }], usage: { inputTokens: 100_000 } }, { text: "ok" }],
      0.001,
    );
    await drain(session.send("go"));
    // Still over the budget: the next message pauses too, before any call
    expect((await drain(session.send("something else"))).at(-1)?.type).toBe("budget_reached");
    expect(client.requests).toHaveLength(1);
    session.setBudget(null);
    await drain(session.retry());
    expect(client.requests[1]!.input).toContainEqual({ role: "user", content: BUDGET_NOTE });
  });
});
