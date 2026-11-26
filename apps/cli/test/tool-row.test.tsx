import { render } from "ink-testing-library";
import { describe, expect, it } from "vitest";
import { ToolRow } from "../src/ui/ToolRow.js";

describe("ToolRow", () => {
  it("shows the label, summary and numbered diff", () => {
    const { lastFrame } = render(
      <ToolRow
        item={{
          kind: "tool",
          id: 1,
          callId: "c1",
          name: "edit",
          args: '{"path":"src/math.js"}',
          status: "done",
          startedAt: 0,
          summary: "+1 -1",
          durationMs: 3,
          diff: "--- a\n+++ b\n@@ -4,1 +4,1 @@\n-  return a + b;\n+  return a * b;",
        }}
      />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Edit(src/math.js)");
    expect(frame).toContain("Changed with 1 addition and 1 removal");
    expect(frame).toContain("4 -   return a + b;");
    expect(frame).toContain("4 +   return a * b;");
  });

  it("shows the error summary for a failed tool", () => {
    const { lastFrame } = render(
      <ToolRow
        item={{
          kind: "tool",
          id: 2,
          callId: "c2",
          name: "bash",
          args: '{"command":"npm test"}',
          status: "error",
          startedAt: 0,
          summary: "exit 1",
          preview: "1 failing",
        }}
      />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Bash(npm test)");
    expect(frame).toContain("Exit code 1");
    expect(frame).toContain("1 failing");
  });

  it("shows command output instead of the exit code on success", () => {
    const { lastFrame } = render(
      <ToolRow
        item={{
          kind: "tool",
          id: 3,
          callId: "c3",
          name: "bash",
          args: '{"command":"node --test"}',
          status: "done",
          startedAt: 0,
          summary: "exit 0",
          preview: "pass 3\nfail 0",
        }}
      />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("pass 3");
    expect(frame).toContain("fail 0");
    expect(frame).not.toContain("Exit code");
  });
});
