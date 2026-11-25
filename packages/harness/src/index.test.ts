import { describe, expect, it } from "vitest";
import { HARNESS_VERSION } from "./index.js";

describe("harness", () => {
  it("exposes a version", () => {
    expect(HARNESS_VERSION).toBe("0.0.0");
  });
});
