import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { defaultTools } from "../index.js";
import { FakeModelClient } from "../model/fake.js";
import { Session } from "./session.js";

describe("read then edit flow", () => {
  it("lets the model read a file and then edit it", async () => {
    const root = await mkdtemp(join(tmpdir(), "nimbus-flow-"));
    await writeFile(join(root, "greet.ts"), 'export const hi = "hello";\n');

    const client = new FakeModelClient([
      { toolCalls: [{ name: "read_file", args: { path: "greet.ts", offset: null, limit: null } }] },
      {
        toolCalls: [
          {
            name: "edit",
            args: {
              path: "greet.ts",
              old_string: '"hello"',
              new_string: '"namaste"',
              replace_all: null,
            },
          },
        ],
      },
      { text: "Changed the greeting in greet.ts:1." },
    ]);
    const session = new Session({
      client,
      model: "gpt-6-luna",
      instructions: "test",
      cwd: root,
      tools: defaultTools,
    });

    const ends = [];
    for await (const event of session.send("say namaste")) {
      if (event.type === "tool_call_end") ends.push(event);
    }

    expect(ends.map((event) => event.isError)).toEqual([false, false]);
    expect(ends[1]?.diff).toContain('+export const hi = "namaste";');
    expect(await readFile(join(root, "greet.ts"), "utf8")).toBe('export const hi = "namaste";\n');
  });
});
