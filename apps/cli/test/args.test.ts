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

  it("reads key and use with their action", () => {
    expect(parseArgs(["key", "set"])).toMatchObject({ command: "key", action: "set" });
    expect(parseArgs(["key"])).toMatchObject({ command: "key", folder: undefined });
    expect(parseArgs(["use", "key"])).toMatchObject({ command: "use", action: "key" });
    expect(parseArgs(["use", "app"])).toMatchObject({ command: "use", folder: "app" });
  });

  it("reads --resume and --continue anywhere", () => {
    expect(parseArgs(["--resume"])).toMatchObject({ resume: "pick", folder: undefined });
    expect(parseArgs(["app", "--continue"])).toMatchObject({ resume: "latest", folder: "app" });
    expect(parseArgs(["app"])).not.toHaveProperty("resume");
  });
});
