import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MIGRATIONS_FOLDER } from "../src/db/client.js";

describe("migrations folder", () => {
  it("points at apps/server/drizzle", () => {
    expect(MIGRATIONS_FOLDER.replaceAll("\\\\", "/")).toMatch(/apps\/server\/drizzle$/);
    expect(existsSync(`${MIGRATIONS_FOLDER}/meta/_journal.json`)).toBe(true);
  });
});
