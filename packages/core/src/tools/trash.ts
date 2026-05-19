/**
 * The trash. No Anvil tool deletes a file — removal moves it here, under
 * `.anvil/trash/`, so every removal is reversible.
 */
import { mkdirSync, renameSync } from "node:fs";
import { basename, join } from "node:path";
import type { Workspace } from "../lib/workspace.js";

/** Move a path into the workspace trash. Returns the new location. */
export function moveToTrash(workspace: Workspace, target: string): string {
  const absolute = workspace.resolve(target);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const trashDir = join(workspace.root, ".anvil", "trash", stamp);
  mkdirSync(trashDir, { recursive: true });
  const destination = join(trashDir, basename(absolute));
  renameSync(absolute, destination);
  return destination;
}
