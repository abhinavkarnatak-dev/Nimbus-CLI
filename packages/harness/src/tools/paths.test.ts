import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { isInside } from "./paths.js";
import { truncateOutput } from "./truncate.js";

describe("isInside", () => {
  const root = join("/", "project");
  it("accepts the root and children", () => {
    expect(isInside(root, root)).toBe(true);
    expect(isInside(root, join(root, "src", "a.ts"))).toBe(true);
  });
  it("rejects parents and siblings", () => {
    expect(isInside(root, join("/", "other"))).toBe(false);
    expect(isInside(root, join(root, "..", "project-2"))).toBe(false);
  });
});

describe("truncateOutput", () => {
  it("keeps short text", () => {
    expect(truncateOutput("hello", 10)).toBe("hello");
  });

  it("keeps whole lines from the start and more from the end, and says where the rest is", () => {
    const text = Array.from({ length: 100 }, (_, i) => `line ${i + 1}`).join("\n");
    const result = truncateOutput(text, 300, "/home/me/.nimbus/outputs/s1/call_1.txt");
    const lines = result.split("\n");
    expect(lines[0]).toBe("line 1");
    expect(lines.at(-1)).toBe("line 100");
    expect(result).toContain(
      "[Output too long: showed the first 13 and last 24 of 100 lines. The full output is saved at /home/me/.nimbus/outputs/s1/call_1.txt. Search it with grep or read parts of it with read_file.]",
    );
    expect(result).not.toContain("line 50\n");
  });

  it("says the middle is gone when nothing was saved", () => {
    const text = Array.from({ length: 100 }, (_, i) => `line ${i + 1}`).join("\n");
    expect(truncateOutput(text, 300)).toContain("The middle was left out.]");
  });

  it("cuts one huge line by characters", () => {
    const result = truncateOutput("a".repeat(50) + "b".repeat(50), 30);
    expect(result.startsWith("a".repeat(10))).toBe(true);
    expect(result.endsWith("b".repeat(20))).toBe(true);
    expect(result).toContain("showed the first 10 and last 20 of 100 characters");
  });
});
