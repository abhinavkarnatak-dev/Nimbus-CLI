import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { FileMemory, MAX_FACTS, memoryReport, projectMemoryPath } from "../src/store/memory.js";

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), "nimbus-memory-"));
  const projectPath = projectMemoryPath(dir, "/work/shop");
  return {
    dir,
    projectPath,
    memory: new FileMemory(join(dir, "memory.md"), projectPath, "/work/shop"),
  };
}

describe("FileMemory", () => {
  it("keeps user and project facts in separate files, outside the project", async () => {
    const { dir, projectPath, memory } = await setup();
    expect(memory.save("The user likes short answers", "user")).toBe("saved");
    expect(memory.save("Prices are in rupees", "project")).toBe("saved");
    expect(memory.save("prices are in RUPEES", "project")).toBe("duplicate");
    expect(memory.list()).toEqual({
      user: ["The user likes short answers"],
      project: ["Prices are in rupees"],
    });
    expect(await readFile(join(dir, "memory.md"), "utf8")).toBe(
      "# Nimbus memory\n\n- The user likes short answers\n",
    );
    expect(projectPath.startsWith(join(dir, "projects"))).toBe(true);
    expect(await readFile(join(dirname(projectPath), "folder.txt"), "utf8")).toBe("/work/shop");
  });

  it("forgets by the number /memory shows", async () => {
    const { memory } = await setup();
    memory.save("A", "user");
    memory.save("B", "project");
    memory.save("C", "project");
    expect(memoryReport(memory.list())).toContain("  3. C");
    expect(memory.forget(2)).toBe("B");
    expect(memory.forget(9)).toBeNull();
    expect(memory.list()).toEqual({ user: ["A"], project: ["C"] });
  });

  it("stops at the limit and explains an empty memory", async () => {
    const { memory } = await setup();
    for (let i = 0; i < MAX_FACTS; i++) memory.save(`fact ${i}`, "user");
    expect(memory.save("one more", "user")).toBe("full");
    expect(memoryReport({ user: [], project: [] })[0]).toContain("Nothing saved yet");
  });
});
