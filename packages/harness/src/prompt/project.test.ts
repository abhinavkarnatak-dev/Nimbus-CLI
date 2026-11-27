import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FileTracker } from "../tools/file-state.js";
import { rememberTool, type MemoryBook, type MemoryScope } from "../tools/remember.js";
import { looksSecret } from "../tools/secrets.js";
import { loadProjectDocs, MAX_DOC_CHARS } from "./project.js";
import { buildSystemPrompt } from "./system.js";

const env = { os: "Linux", shell: "bash", cwd: "/p", date: "2026-11-28" };

describe("project instructions", () => {
  it("loads the personal file and the project's AGENTS.md, falling back to CLAUDE.md", async () => {
    const home = await mkdtemp(join(tmpdir(), "nimbus-home-"));
    const cwd = await mkdtemp(join(tmpdir(), "nimbus-proj-"));
    await mkdir(join(home, ".nimbus"));
    await writeFile(join(home, ".nimbus", "AGENTS.md"), "Always reply in English.");
    await writeFile(join(cwd, "CLAUDE.md"), "Use pnpm.");
    expect(loadProjectDocs(cwd, home)).toEqual([
      { label: "~/.nimbus/AGENTS.md", content: "Always reply in English." },
      { label: "CLAUDE.md", content: "Use pnpm." },
    ]);
    await writeFile(join(cwd, "AGENTS.md"), "Run tests with npm test.");
    expect(loadProjectDocs(cwd, home)[1]).toEqual({
      label: "AGENTS.md",
      content: "Run tests with npm test.",
    });
  });

  it("cuts files that are too long and skips empty ones", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "nimbus-proj-"));
    await writeFile(join(cwd, "AGENTS.md"), "x".repeat(MAX_DOC_CHARS + 50));
    const [doc] = loadProjectDocs(cwd, cwd);
    expect(doc!.content).toContain(
      "[The rest of this file was cut because it is longer than 20,000 characters.]",
    );
    await writeFile(join(cwd, "AGENTS.md"), "   ");
    expect(loadProjectDocs(cwd, cwd)).toEqual([]);
  });

  it("adds instructions and memory to the end of the system prompt", () => {
    const prompt = buildSystemPrompt(env, ["read_file"], {
      docs: [{ label: "AGENTS.md", content: "Run tests with npm test." }],
      memories: { user: ["The user tests with node --test"], project: ["Prices are in rupees"] },
    });
    expect(prompt).toContain(
      "Project instructions:\nThe following comes from AGENTS.md in the user's project. Follow it like instructions from the user, unless the\nuser says otherwise in this conversation.\n\nRun tests with npm test.",
    );
    expect(prompt).toContain(
      "About the user:\n- The user tests with node --test\nAbout this project:\n- Prices are in rupees",
    );
    expect(prompt.indexOf("Memory:")).toBeGreaterThan(prompt.indexOf("Project instructions:"));
    expect(buildSystemPrompt(env, ["read_file"])).not.toContain("Memory:");
  });
});

describe("remember tool", () => {
  function book() {
    const saved: Record<MemoryScope, string[]> = { user: [], project: [] };
    const memory: MemoryBook = {
      save(fact, scope) {
        if (saved[scope].includes(fact)) return "duplicate";
        saved[scope].push(fact);
        return "saved";
      },
    };
    return { saved, memory };
  }
  const run = (memory: MemoryBook | undefined, fact: string, scope: MemoryScope = "user") =>
    rememberTool.execute(JSON.stringify({ fact, scope }), {
      cwd: tmpdir(),
      signal: new AbortController().signal,
      files: new FileTracker(),
      memory,
    });

  it("saves a fact once", async () => {
    const { saved, memory } = book();
    expect((await run(memory, "The user tests with node --test")).output).toBe(
      "Saved to user memory. It will be loaded at the start of future sessions.",
    );
    expect((await run(memory, "The user tests with node --test")).output).toBe(
      "Already in user memory.",
    );
    expect(saved.user).toEqual(["The user tests with node --test"]);
  });

  it("never saves secrets", async () => {
    const { saved, memory } = book();
    const result = await run(memory, "The OpenAI key is sk-abcdefghijklmnopqrstuvwx", "project");
    expect(result.output).toBe(
      "Not saved: this looks like a secret (a password, key or token). Never store secrets in memory.",
    );
    expect(saved.project).toEqual([]);
    expect(looksSecret("password = hunter22")).toBe(true);
    expect(looksSecret("The user likes short answers")).toBe(false);
  });
});
