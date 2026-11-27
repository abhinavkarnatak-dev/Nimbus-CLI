import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { FakeModelClient } from "../model/fake.js";
import { FileTracker } from "../tools/file-state.js";
import { grepTool } from "../tools/grep.js";
import { readFileTool } from "../tools/read-file.js";
import { defineTool, type ToolContext } from "../tools/types.js";
import type { AgentEvent } from "./events.js";
import { Session } from "./session.js";

const NOISY = Array.from({ length: 5000 }, (_, i) =>
  i === 2500 ? "ERROR: database connection refused" : `ok test ${i + 1}`,
).join("\n");

const noisy = defineTool({
  name: "noisy",
  description: "Prints a lot.",
  schema: z.strictObject({}),
  async run() {
    return { output: NOISY };
  },
});

let cwd: string;
let outputs: string;
beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), "nimbus-long-"));
  outputs = await mkdtemp(join(tmpdir(), "nimbus-outputs-"));
});

async function drain(events: AsyncIterable<AgentEvent>) {
  for await (const _event of events) void _event;
}

function outputOf(client: FakeModelClient): string {
  const item = client.requests[1]!.input.find(
    (entry) => (entry as { type?: string }).type === "function_call_output",
  ) as { output: string };
  return item.output;
}

describe("long tool output", () => {
  it("saves the full output and shows the start and end", async () => {
    const client = new FakeModelClient([
      { toolCalls: [{ name: "noisy", args: {} }] },
      { text: "Found it" },
    ]);
    const session = new Session({
      client,
      model: "gpt-6-luna",
      instructions: "x",
      cwd,
      tools: [noisy],
      id: "s1",
      outputDir: outputs,
    });
    await drain(session.send("run it"));
    const saved = join(outputs, "s1", "call_1.txt");
    expect(await readFile(saved, "utf8")).toBe(NOISY);
    const shown = outputOf(client);
    expect(shown.length).toBeLessThan(31_000);
    expect(shown.startsWith("ok test 1\n")).toBe(true);
    expect(shown.endsWith("ok test 5000")).toBe(true);
    expect(shown).toContain(`The full output is saved at ${saved}.`);
    expect(shown).not.toContain("ERROR: database");
  });

  it("says the middle is gone without an output folder", async () => {
    const client = new FakeModelClient([
      { toolCalls: [{ name: "noisy", args: {} }] },
      { text: "ok" },
    ]);
    const session = new Session({
      client,
      model: "gpt-6-luna",
      instructions: "x",
      cwd,
      tools: [noisy],
    });
    await drain(session.send("run it"));
    expect(outputOf(client)).toContain("The middle was left out.]");
  });

  it("lets grep and read_file open saved outputs, and nothing else outside the folder", async () => {
    await mkdir(join(outputs, "s1"), { recursive: true });
    const saved = join(outputs, "s1", "call_1.txt");
    await writeFile(saved, NOISY);
    const ctx: ToolContext = {
      cwd,
      signal: new AbortController().signal,
      files: new FileTracker(),
      outputDir: outputs,
    };
    const found = await grepTool.execute(
      JSON.stringify({
        pattern: "ERROR",
        path: saved,
        glob: null,
        case_insensitive: null,
        output_mode: "content",
      }),
      ctx,
    );
    expect(found.output).toContain("2501:ERROR: database connection refused");

    const read = await readFileTool.execute(
      JSON.stringify({ path: saved, offset: 2499, limit: 5 }),
      ctx,
    );
    expect(read.output).toContain("  2501\tERROR: database connection refused");

    const elsewhere = join(await mkdtemp(join(tmpdir(), "nimbus-other-")), "secret.txt");
    await writeFile(elsewhere, "secret");
    const refused = await readFileTool.execute(
      JSON.stringify({ path: elsewhere, offset: null, limit: null }),
      ctx,
    );
    expect(refused.isError).toBe(true);
    expect(refused.output).toContain("outside the working directory");
  });
});

describe("read_file on a long file", () => {
  it("stops at a whole line and says which offset comes next", async () => {
    const text = Array.from({ length: 3000 }, (_, i) => `row ${i + 1} ${"x".repeat(40)}`).join(
      "\n",
    );
    await writeFile(join(cwd, "big.txt"), text);
    const ctx: ToolContext = {
      cwd,
      signal: new AbortController().signal,
      files: new FileTracker(),
    };
    const first = await readFileTool.execute(
      JSON.stringify({ path: "big.txt", offset: null, limit: null }),
      ctx,
    );
    const match =
      /\[Showed lines 1-(\d+) of 3,000 to keep this short\. To read more, call read_file with offset (\d+)\.\]/.exec(
        first.output,
      );
    expect(match).not.toBeNull();
    const end = Number(match![1]);
    expect(Number(match![2])).toBe(end + 1);
    expect(first.output.length).toBeLessThan(31_000);
    const next = await readFileTool.execute(
      JSON.stringify({ path: "big.txt", offset: end + 1, limit: null }),
      ctx,
    );
    expect(next.output.startsWith(`${String(end + 1).padStart(6)}\trow ${end + 1} `)).toBe(true);
  });
});
