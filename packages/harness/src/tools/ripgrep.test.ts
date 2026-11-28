import { describe, expect, it } from "vitest";
import { rgPath } from "@vscode/ripgrep";
import { ripgrepCommand, runRipgrep } from "./ripgrep.js";

describe("ripgrep", () => {
  it("uses the bundled binary, or rg on the PATH when it never downloaded", () => {
    expect(ripgrepCommand(rgPath)).toBe(rgPath);
    expect(ripgrepCommand("/no/such/rg")).toBe("rg");
    expect(ripgrepCommand(null)).toBe("rg");
  });

  it("finds files with the bundled binary", async () => {
    const run = await runRipgrep(
      ["--files", "src/tools"],
      process.cwd(),
      new AbortController().signal,
      500,
    );
    expect(run.lines).toContain("src/tools/ripgrep.ts");
  });
});
