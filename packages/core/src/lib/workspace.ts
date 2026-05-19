/**
 * Workspace path resolution. Every path the harness touches is resolved through
 * here, so traversal outside the workspace root is mechanically impossible —
 * not a prompt rule, a code check.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { AnvilError } from "./errors.js";

export class Workspace {
  /** The absolute, normalized workspace root. */
  readonly root: string;

  constructor(root: string) {
    this.root = path.resolve(root);
  }

  /** True when `candidate` is the root itself or nested inside it. */
  contains(candidate: string): boolean {
    const abs = path.resolve(candidate);
    return abs === this.root || abs.startsWith(this.root + path.sep);
  }

  /**
   * Resolve a path against the workspace root, rejecting any escape.
   * Accepts relative or absolute input; always returns an absolute path.
   */
  resolve(target: string): string {
    const abs = path.isAbsolute(target) ? path.resolve(target) : path.resolve(this.root, target);
    if (!this.contains(abs)) {
      throw new AnvilError(
        "PATH_OUTSIDE_WORKSPACE",
        `Path "${target}" resolves to "${abs}", which is outside the workspace root "${this.root}". ` +
          `Pass a path inside the workspace.`,
      );
    }
    return abs;
  }

  /** Path relative to the root, for display. */
  relative(target: string): string {
    return path.relative(this.root, this.resolve(target));
  }

  /** Walk up from `start` to find the nearest directory holding a marker file. */
  static discover(start: string, markers: readonly string[] = ["package.json", ".git"]): Workspace {
    let dir = path.resolve(start);
    for (;;) {
      if (markers.some((marker) => existsSync(path.join(dir, marker)))) {
        return new Workspace(dir);
      }
      const parent = path.dirname(dir);
      if (parent === dir) {
        throw new AnvilError(
          "WORKSPACE_NOT_FOUND",
          `No workspace root found above "${start}" (looked for ${markers.join(", ")}).`,
        );
      }
      dir = parent;
    }
  }
}
