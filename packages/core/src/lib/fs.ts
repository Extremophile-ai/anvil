/**
 * Filesystem walking. One implementation, shared by the discovery tools and
 * workspace ingestion, so the "what to skip" rules never drift apart.
 */
import { readdirSync } from "node:fs";
import { join, relative } from "node:path";

/** Directories never worth walking — build output, dependencies, VCS, caches. */
export const DEFAULT_SKIP_DIRS: ReadonlySet<string> = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "out",
  "coverage",
  ".anvil",
  ".next",
  ".turbo",
  ".cache",
]);

export interface WalkOptions {
  /** Directory to start from. Defaults to `root`. */
  start?: string;
  /** Stop after collecting this many files. */
  maxEntries?: number;
  /** Directory names to skip. Defaults to {@link DEFAULT_SKIP_DIRS}. */
  skip?: ReadonlySet<string>;
}

/** Recursively list files under `root` as paths relative to it. */
export function walkFiles(root: string, options: WalkOptions = {}): string[] {
  const skip = options.skip ?? DEFAULT_SKIP_DIRS;
  const maxEntries = options.maxEntries ?? 10_000;
  const files: string[] = [];
  const stack: string[] = [options.start ?? root];
  while (stack.length > 0 && files.length < maxEntries) {
    const dir = stack.pop();
    if (dir === undefined) break;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (skip.has(entry.name)) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else files.push(relative(root, full));
    }
  }
  return files;
}
