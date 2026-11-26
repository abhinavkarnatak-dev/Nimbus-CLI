import { describe, expect, it } from "vitest";
import { parseArgs } from "../src/args.js";

describe("parseArgs", () => {
  it("keeps the folder when there is no command or code", () => {
    expect(parseArgs(["C:\\work\\app"])).toEqual({
      command: null,
      inviteCode: undefined,
      folder: "C:\\work\\app",
    });
  });

  it("reads login with a code and a folder in any order", () => {
    expect(parseArgs(["login", "--code", "LAUNCH20", "app"])).toEqual({
      command: "login",
      inviteCode: "LAUNCH20",
      folder: "app",
    });
    expect(parseArgs(["login", "app", "--code", "X1"])).toMatchObject({
      folder: "app",
      inviteCode: "X1",
    });
  });

  it("handles logout and no arguments", () => {
    expect(parseArgs(["logout"])).toEqual({
      command: "logout",
      inviteCode: undefined,
      folder: undefined,
    });
    expect(parseArgs([])).toEqual({ command: null, inviteCode: undefined, folder: undefined });
  });
});
