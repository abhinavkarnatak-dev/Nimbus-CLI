import { describe, expect, it } from "vitest";
import { BUILT_IN_SKILLS, type Skill } from "@nimbus/harness";
import { ModelChoice } from "../src/model-choice.js";
import { readFileSync } from "node:fs";
import { memorySettings } from "../src/settings.js";
import { shownMessage, shownTitle } from "../src/ui/shown.js";
import {
  commitRequest,
  COMMIT_REQUEST,
  matchCommands,
  parseCommand,
  parseCommitRequest,
  skillCommands,
  INIT_REQUEST,
} from "../src/ui/commands.js";

describe("parseCommand", () => {
  it("splits known commands from their argument", () => {
    expect(parseCommand("/login LAUNCH20")).toEqual({ name: "/login", arg: "LAUNCH20" });
    expect(parseCommand("/USAGE")).toEqual({ name: "/usage", arg: "" });
  });

  it("treats unknown commands without text as commands and paths as messages", () => {
    expect(parseCommand("/nope")).toEqual({ name: "/nope", arg: "" });
    expect(parseCommand("/usr/bin has my node, why?")).toBeNull();
    expect(parseCommand("hello")).toBeNull();
  });

  it("knows skills by name, with text after them, and lets built-in commands win", () => {
    const help: Skill = { ...BUILT_IN_SKILLS[0]!, name: "help", description: "My help" };
    const skills = skillCommands([...BUILT_IN_SKILLS, help]);
    expect(skills.map((command) => command.name)).toEqual(["/create-skill"]);
    expect(parseCommand("/create-skill a review skill", skills)).toEqual({
      name: "/create-skill",
      arg: "a review skill",
    });
    expect(parseCommand("/create-skill a review skill")).toBeNull();
    expect(matchCommands("/cr", skills).map((command) => command.name)).toEqual(["/create-skill"]);
  });

  it("reads a saved /commit request back as what the user typed", () => {
    expect(parseCommitRequest(commitRequest(""))).toBe("/commit");
    expect(parseCommitRequest(commitRequest("  login fix "))).toBe("/commit login fix");
    expect(commitRequest("x").startsWith(COMMIT_REQUEST)).toBe(true);
    expect(parseCommitRequest("commit this")).toBeNull();
  });

  it("falls back to Luna and a level the model accepts", () => {
    expect(new ModelChoice(memorySettings({ model: "gpt-9" })).model).toBe("gpt-6-luna");
    const astra = new ModelChoice(memorySettings({ model: "gpt-6.2-astra", effort: "none" }));
    expect([astra.model, astra.effort]).toEqual(["gpt-6.2-astra", "medium"]);
  });

  it("shows what the user typed instead of a hidden request, also for old titles", () => {
    expect(shownMessage(INIT_REQUEST)).toBe("/init");
    expect(shownMessage(commitRequest("x"))).toBe("/commit x");
    expect(shownMessage("hello")).toBe("hello");
    expect(shownTitle(INIT_REQUEST.slice(0, 120))).toBe("/init");
    expect(shownTitle(COMMIT_REQUEST.slice(0, 120))).toBe("/commit");
    expect(
      shownTitle('The user ran the skill "count-js-lines" by typing /count-js-lines. Fol'),
    ).toBe("/count-js-lines");
    expect(shownTitle("Fix the login bug")).toBe("Fix the login bug");
  });

  it("imports only types from the harness, because the website builds without it", () => {
    const source = readFileSync(new URL("../src/ui/commands.ts", import.meta.url), "utf8");
    const imports = source.match(/^import .* from "@nimbus\/harness";$/gm) ?? [];
    expect(imports.every((line) => line.startsWith("import type "))).toBe(true);
  });
});
