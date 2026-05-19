/**
 * The file layer of memory — facts as markdown files on disk. These files are
 * the canonical, human-readable, git-diffable record; the SQLite mirror and the
 * vector index are derived from them.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  type MemoryFact,
  type MemoryId,
  type MemoryScope,
  type MemoryType,
  newMemoryId,
} from "@anvil/shared";
import { parseDocument, serializeDocument } from "./frontmatter.js";

const MEMORY_TYPES: readonly MemoryType[] = ["user", "feedback", "project", "reference"];

function coerceType(value: string | undefined): MemoryType {
  return MEMORY_TYPES.includes(value as MemoryType) ? (value as MemoryType) : "project";
}

function parseTags(value: string | undefined): string[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

export class MemoryFileStore {
  constructor(private readonly dirs: Record<MemoryScope, string>) {}

  private dir(scope: MemoryScope): string {
    const dir = this.dirs[scope];
    mkdirSync(dir, { recursive: true });
    return dir;
  }

  private file(scope: MemoryScope, name: string): string {
    return join(this.dir(scope), `${name}.md`);
  }

  list(scope: MemoryScope): MemoryFact[] {
    const dir = this.dir(scope);
    return readdirSync(dir)
      .filter((entry) => entry.endsWith(".md"))
      .map((entry) => this.read(scope, entry.slice(0, -3)))
      .filter((fact): fact is MemoryFact => fact !== undefined);
  }

  read(scope: MemoryScope, name: string): MemoryFact | undefined {
    const path = this.file(scope, name);
    if (!existsSync(path)) return undefined;
    const { frontmatter, body } = parseDocument(readFileSync(path, "utf8"));
    const now = new Date().toISOString();
    return {
      id: (frontmatter.id ?? newMemoryId()) as MemoryId,
      name: frontmatter.name ?? name,
      scope,
      type: coerceType(frontmatter.type),
      description: frontmatter.description ?? "",
      body,
      tags: parseTags(frontmatter.tags),
      createdAt: frontmatter.created ?? now,
      updatedAt: frontmatter.updated ?? now,
    };
  }

  write(fact: MemoryFact): void {
    const document = serializeDocument(
      {
        id: fact.id,
        name: fact.name,
        description: fact.description,
        type: fact.type,
        tags: JSON.stringify(fact.tags),
        created: fact.createdAt,
        updated: fact.updatedAt,
      },
      fact.body,
    );
    writeFileSync(this.file(fact.scope, fact.name), document);
  }

  remove(scope: MemoryScope, name: string): boolean {
    const path = this.file(scope, name);
    if (!existsSync(path)) return false;
    rmSync(path);
    return true;
  }
}
