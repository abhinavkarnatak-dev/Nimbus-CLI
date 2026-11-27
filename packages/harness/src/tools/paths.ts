import { mkdir, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

function normalizeCase(path: string): string {
  return process.platform === "win32" ? path.toLowerCase() : path;
}

export function isInside(root: string, target: string): boolean {
  const rel = relative(normalizeCase(root), normalizeCase(target));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

export function toDisplayPath(root: string, target: string): string {
  return relative(root, target).split(sep).join("/") || ".";
}

// "~/x" means the user's home folder
export function expandHome(path: string): string {
  return /^~(?=$|[\\/])/.test(path) ? homedir() + path.slice(1) : path;
}

// Relative inside cwd, ~/ for the home folder
export async function displayFor(cwd: string, target: string): Promise<string> {
  const root = await realpath(cwd);
  if (isInside(root, target)) return toDisplayPath(root, target);
  const home = await realpath(homedir()).catch(() => homedir());
  return isInside(home, target) ? `~/${toDisplayPath(home, target)}` : target.split(sep).join("/");
}

type Dirs = readonly (string | null | undefined)[];
const present = (dirs: Dirs) => dirs.filter((dir): dir is string => Boolean(dir));

// Resolve path, refuse anything outside root
export async function resolveInside(cwd: string, path: string): Promise<string> {
  const root = await realpath(cwd);
  const absolute = resolve(root, expandHome(path));
  if (!isInside(root, absolute)) {
    throw new Error(`path is outside the working directory: ${path}`);
  }

  let real: string;
  try {
    real = await realpath(absolute);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`file not found: ${path}`, { cause: error });
    }
    throw error;
  }

  if (!isInside(root, real)) {
    throw new Error(`path is outside the working directory: ${path}`);
  }
  return real;
}

export interface WriteTarget {
  root: string;
  path: string;
  exists: boolean;
}

// Resolve a path that may not exist yet
export async function resolveForWrite(
  cwd: string,
  path: string,
  extra: Dirs = [],
): Promise<WriteTarget> {
  const cwdRoot = await realpath(cwd);
  const absolute = resolve(cwdRoot, expandHome(path));
  let root = cwdRoot;
  if (!isInside(root, absolute)) {
    let found: string | null = null;
    for (const dir of present(extra)) {
      if (!isInside(resolve(dir), absolute)) continue;
      // The folder may not exist before the first skill
      await mkdir(dir, { recursive: true });
      found = await realpath(dir);
      break;
    }
    if (!found) throw new Error(`path is outside the working directory: ${path}`);
    root = found;
  }

  let current = absolute;
  for (;;) {
    try {
      const real = await realpath(current);
      if (!isInside(root, real)) {
        throw new Error(`path is outside the working directory: ${path}`);
      }
      return current === absolute
        ? { root, path: real, exists: true }
        : { root, path: absolute, exists: false };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const parent = dirname(current);
      if (parent === current) throw error;
      current = parent;
    }
  }
}

// Nimbus's saved outputs and skill folders are readable too
export async function resolveReadable(
  cwd: string,
  path: string,
  extra?: string | Dirs,
): Promise<{ root: string; path: string }> {
  try {
    return { root: await realpath(cwd), path: await resolveInside(cwd, path) };
  } catch (error) {
    const dirs = present(typeof extra === "string" ? [extra] : (extra ?? []));
    const full = expandHome(path);
    if (dirs.length === 0 || !isAbsolute(full)) throw error;
    const real = await realpath(full).catch(() => null);
    if (!real) throw error;
    for (const dir of dirs) {
      const root = await realpath(dir).catch(() => null);
      if (root && isInside(root, real)) return { root, path: real };
    }
    throw error;
  }
}

// Folders outside cwd that read_file and grep may read
export function readableDirs(ctx: {
  outputDir?: string;
  skillsDir?: string;
  skills?: readonly { folder: string | null }[];
}): (string | null | undefined)[] {
  return [ctx.outputDir, ctx.skillsDir, ...(ctx.skills ?? []).map((skill) => skill.folder)];
}

// An existing file to edit, in cwd or an extra folder
export async function resolveEditable(
  cwd: string,
  path: string,
  extra: Dirs = [],
): Promise<string> {
  try {
    return await resolveInside(cwd, path);
  } catch (error) {
    const full = expandHome(path);
    if (!String((error as Error).message).startsWith("path is outside") || !isAbsolute(full)) {
      throw error;
    }
    for (const dir of present(extra)) {
      const base = await realpath(dir).catch(() => null);
      if (!base || !isInside(base, resolve(full))) continue;
      const real = await realpath(full).catch((cause: unknown) => {
        throw new Error(`file not found: ${path}`, { cause });
      });
      if (isInside(base, real)) return real;
    }
    throw error;
  }
}
