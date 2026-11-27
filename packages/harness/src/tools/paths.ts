import { realpath } from "node:fs/promises";
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

// Resolve path, refuse anything outside root
export async function resolveInside(cwd: string, path: string): Promise<string> {
  const root = await realpath(cwd);
  const absolute = resolve(root, path);
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
export async function resolveForWrite(cwd: string, path: string): Promise<WriteTarget> {
  const root = await realpath(cwd);
  const absolute = resolve(root, path);
  if (!isInside(root, absolute)) {
    throw new Error(`path is outside the working directory: ${path}`);
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

// Nimbus's saved outputs are readable too
export async function resolveReadable(
  cwd: string,
  path: string,
  outputDir?: string,
): Promise<{ root: string; path: string }> {
  try {
    return { root: await realpath(cwd), path: await resolveInside(cwd, path) };
  } catch (error) {
    if (!outputDir || !isAbsolute(path)) throw error;
    let root: string;
    try {
      root = await realpath(outputDir);
    } catch {
      throw error;
    }
    const real = await realpath(path).catch(() => null);
    if (!real || !isInside(root, real)) throw error;
    return { root, path: real };
  }
}
