/**
 * Types for workspace ingestion — the detected stack, the project profile, and
 * the indexed code chunks.
 */

export interface StackProfile {
  /** Programming languages in use, e.g. ["typescript", "python"]. */
  languages: string[];
  packageManager?: string;
  /** Detected frameworks and tools, e.g. ["next", "express", "vitest"]. */
  frameworks: string[];
  /** Runtimes the project targets, e.g. ["node"]. */
  runtimes: string[];
  hasDocker: boolean;
  hasGit: boolean;
  monorepo: boolean;
}

export interface ProjectProfile {
  root: string;
  name: string;
  stack: StackProfile;
  /** Top-level directories and files worth knowing about. */
  topLevel: string[];
  fileCount: number;
  /** Convention files found, e.g. ["CLAUDE.md", "README.md"]. */
  conventions: string[];
  generatedAt: string;
}

export interface CodeChunk {
  id: string;
  path: string;
  startLine: number;
  endLine: number;
  content: string;
}

export interface CodeHit extends CodeChunk {
  /** Cosine similarity to the query. */
  score: number;
}

export interface IngestionResult {
  profile: ProjectProfile;
  index: { files: number; chunks: number };
}
