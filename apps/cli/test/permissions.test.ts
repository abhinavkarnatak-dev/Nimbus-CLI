import type { ApprovalRequest } from "@nimbus/harness";
import { describe, expect, it } from "vitest";
import { commandKey, Permissions, type ApprovalPrompt } from "../src/permissions.js";
import { memorySettings } from "../src/settings.js";

const signal = new AbortController().signal;
const edit: ApprovalRequest = { tool: "edit", args: { path: "a.ts" }, callId: "c1" };
const bash = (command: string): ApprovalRequest => ({
  tool: "bash",
  args: { command },
  callId: "c2",
});

function setup(mode?: "ask" | "edits" | "full", answer: "yes" | "always" | "no" = "yes") {
  const settings = memorySettings(mode ? { permissions: mode } : {});
  const permissions = new Permissions(settings);
  const asked: ApprovalPrompt[] = [];
  permissions.prompt = async (prompt) => {
    asked.push(prompt);
    return answer;
  };
  return { permissions, asked, settings };
}

describe("commandKey", () => {
  it("keeps the program and its subcommand", () => {
    expect(commandKey("npm test")).toBe("npm test");
    expect(commandKey("npm run build --watch")).toBe("npm run build");
    expect(commandKey("node src/index.js")).toBe("node");
    expect(commandKey("git status -s")).toBe("git status");
    expect(commandKey("ls -la")).toBe("ls");
  });

  it("never remembers chained commands", () => {
    expect(commandKey("npm test && rm -rf build")).toBeNull();
    expect(commandKey("cat a | grep b")).toBeNull();
    expect(commandKey("echo $(whoami)")).toBeNull();
  });
});

describe("Permissions", () => {
  it("asks for edits and commands by default", async () => {
    const { permissions, asked } = setup();
    expect(await permissions.approve(edit, signal)).toBe("allow");
    expect(await permissions.approve(bash("npm test"), signal)).toBe("allow");
    expect(asked.map((prompt) => prompt.remember)).toEqual(["file edits", '"npm test"']);
  });

  it("remembers 'don't ask again' for the session only", async () => {
    const { permissions, asked } = setup("ask", "always");
    await permissions.approve(edit, signal);
    await permissions.approve(edit, signal);
    await permissions.approve(bash("npm test"), signal);
    await permissions.approve(bash("npm test"), signal);
    await permissions.approve(bash("npm run build"), signal);
    expect(asked).toHaveLength(3);
    permissions.resetSession();
    await permissions.approve(edit, signal);
    expect(asked).toHaveLength(4);
  });

  it("edits on its own in auto edits mode but still asks for commands", async () => {
    const { permissions, asked } = setup("edits");
    await permissions.approve(edit, signal);
    await permissions.approve(bash("npm test"), signal);
    expect(asked.map((prompt) => prompt.request.tool)).toEqual(["bash"]);
  });

  it("asks in don't ask mode for git changes, publishing and secret files", async () => {
    const { permissions, asked } = setup("full");
    await permissions.approve(edit, signal);
    await permissions.approve(bash("npm test"), signal);
    await permissions.approve(bash("git push origin main"), signal);
    await permissions.approve(bash("cat .env"), signal);
    expect(asked.map((prompt) => prompt.warning)).toEqual([
      "This command pushes to a remote git repository.",
      "This command touches a secret file.",
    ]);
    expect(asked.every((prompt) => prompt.remember === null)).toBe(true);
  });

  it("says no when there is nobody to ask, and saves the mode", async () => {
    const { permissions, settings } = setup();
    permissions.prompt = null;
    expect(await permissions.approve(edit, signal)).toBe("deny");
    permissions.setMode("edits");
    expect(settings.load().permissions).toBe("edits");
    expect(new Permissions(settings).mode).toBe("edits");
  });

  it("passes the no through", async () => {
    const { permissions } = setup("ask", "no");
    expect(await permissions.approve(bash("rm a.txt"), signal)).toBe("deny");
  });
});
