import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FakeModelClient } from "../model/fake.js";
import { editTool } from "../tools/edit.js";
import { readFileTool } from "../tools/read-file.js";
import { undoTool } from "../tools/undo.js";
import type { AgentEvent } from "./events.js";
import { Session } from "./session.js";
import { MemorySessionStore } from "./store.js";

async function drain(events: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const all: AgentEvent[] = [];
  for await (const event of events) all.push(event);
  return all;
}

const undoArgs = { replies: null, paths: null, restore_to: null, overwrite_user_edits: null };

describe("Session undo", () => {
  it("saves file copies to the store and undoes after a resume", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "nimbus-sundo-"));
    await writeFile(join(cwd, "a.txt"), "old\n");
    const store = new MemorySessionStore();
    const tools = [readFileTool, editTool, undoTool];
    const first = new Session({
      client: new FakeModelClient([
        {
          toolCalls: [
            { name: "read_file", args: { path: "a.txt", offset: null, limit: null } },
            {
              name: "edit",
              args: { path: "a.txt", old_string: "old", new_string: "new", replace_all: null },
            },
          ],
        },
        { text: "Changed it." },
      ]),
      model: "gpt-6-luna",
      instructions: "x",
      cwd,
      tools,
      id: "s1",
      store,
    });
    await drain(first.send("change a.txt"));
    expect(await readFile(join(cwd, "a.txt"), "utf8")).toBe("new\n");
    const saved = store.fileChanges.get("s1")!;
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ turn: 1, turnTitle: "change a.txt", display: "a.txt" });

    const resumed = new Session({
      client: new FakeModelClient([
        { toolCalls: [{ name: "undo_changes", args: undoArgs }] },
        { text: "Undone." },
      ]),
      model: "gpt-6-luna",
      instructions: "x",
      cwd,
      tools,
      id: "s1",
      store,
      resume: {
        // Fake call ids start again at call_1, so leave the old calls out
        history: [],
        turns: 1,
        title: "change a.txt",
        usage: first.usage,
        cost: 0,
        fileChanges: saved,
      },
    });
    const events = await drain(resumed.send("undo that"));
    expect(await readFile(join(cwd, "a.txt"), "utf8")).toBe("old\n");
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "tool_call_end",
        name: "undo_changes",
        summary: "restored 1",
      }),
    );
    expect(store.fileChanges.get("s1")).toHaveLength(2);
  });
});
