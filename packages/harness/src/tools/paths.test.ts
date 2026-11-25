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
  it("keeps head and tail of long text", () => {
    const result = truncateOutput("a".repeat(50) + "b".repeat(50), 20);
    expect(result.startsWith("a".repeat(10))).toBe(true);
    expect(result.endsWith("b".repeat(10))).toBe(true);
    expect(result).toContain("80 characters truncated");
  });
});
