/**
 * The project profiler — combines stack detection with a structure scan and
 * the project's own convention files into a single profile, persisted to
 * `.anvil/profile.json`.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { DEFAULT_SKIP_DIRS, walkFiles } from "../lib/fs.js";
import type { Workspace } from "../lib/workspace.js";
import { detectStack, readJson } from "./stack-detector.js";
import type { ProjectProfile } from "./types.js";

const CONVENTION_FILES = [
  "CLAUDE.md",
  "AGENTS.md",
  "GEMINI.md",
  ".cursorrules",
  ".windsurfrules",
  "README.md",
  "CONTRIBUTING.md",
];

const PROFILE_RELATIVE_PATH = join(".anvil", "profile.json");

export function buildProjectProfile(workspace: Workspace): ProjectProfile {
  const root = workspace.root;
  const pkg = readJson(join(root, "package.json"));
  const pkgName = pkg?.name;
  const name = typeof pkgName === "string" ? pkgName : basename(root);
  const topLevel = readdirSync(root)
    .filter((entry) => !DEFAULT_SKIP_DIRS.has(entry) && !entry.startsWith("."))
    .sort();
  const conventions = CONVENTION_FILES.filter((file) => existsSync(join(root, file)));
  return {
    root,
    name,
    stack: detectStack(workspace),
    topLevel,
    fileCount: walkFiles(root, { maxEntries: 50_000 }).length,
    conventions,
    generatedAt: new Date().toISOString(),
  };
}

/** Write the profile to `.anvil/profile.json`. Returns the path written. */
export function saveProfile(workspace: Workspace, profile: ProjectProfile): string {
  const path = join(workspace.root, PROFILE_RELATIVE_PATH);
  mkdirSync(join(workspace.root, ".anvil"), { recursive: true });
  writeFileSync(path, `${JSON.stringify(profile, null, 2)}\n`);
  return path;
}

export function loadProfile(workspace: Workspace): ProjectProfile | undefined {
  const path = join(workspace.root, PROFILE_RELATIVE_PATH);
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as ProjectProfile;
  } catch {
    return undefined;
  }
}
