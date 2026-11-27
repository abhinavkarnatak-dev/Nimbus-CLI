import { readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";

export const OUTPUT_DAYS = 30;

// Delete saved outputs of sessions untouched for a month
export async function cleanOutputs(
  dir: string,
  days = OUTPUT_DAYS,
  now = Date.now(),
): Promise<number> {
  const oldest = now - days * 24 * 60 * 60 * 1000;
  let removed = 0;
  let folders: string[];
  try {
    folders = await readdir(dir);
  } catch {
    return 0;
  }
  for (const name of folders) {
    const folder = join(dir, name);
    try {
      if ((await stat(folder)).mtimeMs < oldest) {
        await rm(folder, { recursive: true, force: true });
        removed++;
      }
    } catch {
      // In use or already gone: try again next start
    }
  }
  return removed;
}
