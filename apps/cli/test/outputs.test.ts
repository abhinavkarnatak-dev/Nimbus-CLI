import { mkdir, mkdtemp, readdir, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cleanOutputs } from "../src/store/outputs.js";

describe("cleanOutputs", () => {
  it("deletes session folders older than 30 days and keeps the rest", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nimbus-outputs-"));
    for (const name of ["old", "new"]) {
      await mkdir(join(dir, name));
      await writeFile(join(dir, name, "call_1.txt"), "x");
    }
    const longAgo = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
    await utimes(join(dir, "old"), longAgo, longAgo);
    expect(await cleanOutputs(dir)).toBe(1);
    expect(await readdir(dir)).toEqual(["new"]);
  });

  it("does nothing when the folder does not exist yet", async () => {
    expect(await cleanOutputs(join(tmpdir(), "nimbus-missing-outputs"))).toBe(0);
  });
});
