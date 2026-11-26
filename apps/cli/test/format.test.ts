import { describe, expect, it } from "vitest";
import {
  describeResult,
  formatCost,
  formatDuration,
  formatTokens,
  parseDiff,
  toolLabel,
} from "../src/ui/format.js";

describe("format", () => {
  it("formats tokens, cost and durations", () => {
    expect(formatTokens(950)).toBe("950");
    expect(formatTokens(12_400)).toBe("12.4k");
    expect(formatTokens(2_000)).toBe("2k");
    expect(formatTokens(1_500_000)).toBe("1.5M");
    expect(formatCost(0.00123)).toBe("$0.0012");
    expect(formatCost(1.234)).toBe("$1.23");
    expect(formatDuration(400)).toBe("400ms");
    expect(formatDuration(2500)).toBe("2.5s");
    expect(formatDuration(125_000)).toBe("2m 5s");
  });

  it("labels each tool call", () => {
    expect(toolLabel("read_file", '{"path":"src/a.ts","offset":null,"limit":null}')).toEqual({
      verb: "Read",
      target: "src/a.ts",
    });
    expect(toolLabel("read_file", '{"path":"a.ts","offset":10,"limit":5}').target).toBe(
      "a.ts (lines 10-14)",
    );
    expect(toolLabel("grep", '{"pattern":"TODO","path":"src"}')).toEqual({
      verb: "Grep",
      target: '"TODO" in src',
    });
    expect(toolLabel("bash", '{"command":"npm test","background":true}').verb).toBe("Start");
    expect(toolLabel("bash", '{"command":"npm test","background":null}')).toEqual({
      verb: "Bash",
      target: "npm test",
    });
    expect(toolLabel("kill_process", '{"id":"proc_1"}')).toEqual({
      verb: "Stop",
      target: "proc_1",
    });
    expect(toolLabel("edit", "not json")).toEqual({ verb: "Edit", target: "" });
  });

  it("turns short tool summaries into sentences", () => {
    expect(describeResult("read_file", "40 lines", false)).toBe("Read 40 lines");
    expect(describeResult("glob", "3 files", false)).toBe("Found 3 files");
    expect(describeResult("edit", "+2 -1", false)).toBe("Changed with 2 additions and 1 removal");
    expect(describeResult("edit", "+1 -0", false)).toBe("Changed with 1 addition");
    expect(describeResult("write_file", "created, 5 lines", false)).toBe("Created with 5 lines");
    expect(describeResult("bash", "exit 1", true)).toBe("Exit code 1");
    expect(describeResult("bash", "started proc_1", false)).toBe("Running in background as proc_1");
    expect(describeResult("edit", "Error: old_string not found\nmore", true)).toBe(
      "old_string not found",
    );
  });

  it("numbers diff lines from the hunk header", () => {
    const diff = [
      "--- a.js",
      "+++ a.js",
      "@@ -10,3 +10,3 @@",
      " const a = 1;",
      "-return a + b;",
      "+return a * b;",
      " }",
    ].join("\n");
    expect(parseDiff(diff)).toEqual([
      { kind: "context", number: 10, text: "const a = 1;" },
      { kind: "remove", number: 11, text: "return a + b;" },
      { kind: "add", number: 11, text: "return a * b;" },
      { kind: "context", number: 12, text: "}" },
    ]);
  });
});
