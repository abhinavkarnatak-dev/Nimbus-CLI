import { describe, expect, it } from "vitest";
import { parseCommand } from "../src/ui/commands.js";

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
});
