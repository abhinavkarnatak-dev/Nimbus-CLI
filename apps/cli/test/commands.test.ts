import { describe, expect, it } from "vitest";
import { BUILT_IN_SKILLS, type Skill } from "@nimbus/harness";
import { matchCommands, parseCommand, skillCommands } from "../src/ui/commands.js";

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
});
