/**
 * Memory facts — the unit of what the harness knows. A fact is a small,
 * human-readable record (it lives on disk as a markdown file) plus an embedding
 * for semantic recall.
 */
import { z } from "zod";
import type { MemoryId } from "./ids.js";

/** Why the fact exists, mirroring the four memory tiers. */
export type MemoryType = "user" | "feedback" | "project" | "reference";

/** Where the fact applies — to one project, or everywhere. */
export type MemoryScope = "project" | "global";

export interface MemoryFact {
  id: MemoryId;
  /** Kebab-case slug, unique within its scope; also the file name. */
  name: string;
  scope: MemoryScope;
  type: MemoryType;
  /** One-line summary — used to decide relevance during recall. */
  description: string;
  /** The fact itself. */
  body: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface RecallResult {
  fact: MemoryFact;
  /** Cosine similarity to the query, in [-1, 1]. */
  score: number;
}

export const memoryTypeSchema = z.enum(["user", "feedback", "project", "reference"]);
export const memoryScopeSchema = z.enum(["project", "global"]);

export const memoryFactSchema = z.strictObject({
  id: z.string(),
  name: z.string(),
  scope: memoryScopeSchema,
  type: memoryTypeSchema,
  description: z.string(),
  body: z.string(),
  tags: z.array(z.string()),
  createdAt: z.string(),
  updatedAt: z.string(),
});

/** Caller-facing input to remember a fact; ids/timestamps are filled in. */
export const rememberInputSchema = z.strictObject({
  name: z.string().min(1).optional(),
  scope: memoryScopeSchema.default("project"),
  type: memoryTypeSchema.default("project"),
  description: z.string().min(1),
  body: z.string().min(1),
  tags: z.array(z.string()).default([]),
});

export type RememberInput = z.input<typeof rememberInputSchema>;
