/**
 * The global skill library — `~/.anvil/skills/`. Generated skills, tools, and
 * plugins live here as markdown files with frontmatter, so they are shared
 * across every project Anvil touches and are git-diffable.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseDocument, serializeDocument } from "../memory/frontmatter.js";
import type { Skill, SkillKind } from "./types.js";

const SUFFIX = ".skill.md";
const SKILL_KINDS: readonly SkillKind[] = ["skill", "tool", "plugin"];

function parseJsonArray(value: string | undefined): string[] {
  try {
    const parsed: unknown = JSON.parse(value ?? "[]");
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

export class SkillLibrary {
  /** Absolute path to the library directory. */
  readonly dir: string;

  constructor(dir: string = join(homedir(), ".anvil", "skills")) {
    this.dir = dir;
  }

  private file(name: string): string {
    return join(this.dir, `${name}${SUFFIX}`);
  }

  has(name: string): boolean {
    return existsSync(this.file(name));
  }

  save(skill: Skill): void {
    mkdirSync(this.dir, { recursive: true });
    const document = serializeDocument(
      {
        id: skill.id,
        kind: skill.kind,
        description: skill.description,
        capabilities: JSON.stringify(skill.capabilities),
        tags: JSON.stringify(skill.tags),
        version: String(skill.version),
        validated: String(skill.validated),
        created: skill.createdAt,
        updated: skill.updatedAt,
      },
      skill.content,
    );
    writeFileSync(this.file(skill.name), document);
  }

  get(name: string): Skill | undefined {
    const path = this.file(name);
    if (!existsSync(path)) return undefined;
    const { frontmatter, body } = parseDocument(readFileSync(path, "utf8"));
    const now = new Date().toISOString();
    const kind = (frontmatter.kind ?? "skill") as SkillKind;
    return {
      id: frontmatter.id ?? `skill_${name}`,
      name,
      kind: SKILL_KINDS.includes(kind) ? kind : "skill",
      description: frontmatter.description ?? "",
      content: body,
      capabilities: parseJsonArray(frontmatter.capabilities),
      tags: parseJsonArray(frontmatter.tags),
      version: Number(frontmatter.version ?? "1") || 1,
      validated: frontmatter.validated === "true",
      createdAt: frontmatter.created ?? now,
      updatedAt: frontmatter.updated ?? now,
    };
  }

  list(): Skill[] {
    if (!existsSync(this.dir)) return [];
    return readdirSync(this.dir)
      .filter((entry) => entry.endsWith(SUFFIX))
      .map((entry) => this.get(entry.slice(0, -SUFFIX.length)))
      .filter((skill): skill is Skill => skill !== undefined);
  }

  /** Library skills matching a capability or keyword query, best match first. */
  search(query: string): Skill[] {
    const terms = query.toLowerCase().match(/[a-z0-9]+/g) ?? [];
    return this.list()
      .map((skill) => {
        const haystack = [skill.name, skill.description, ...skill.capabilities, ...skill.tags]
          .join(" ")
          .toLowerCase();
        const score = terms.reduce((sum, term) => sum + (haystack.includes(term) ? 1 : 0), 0);
        return { skill, score };
      })
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((entry) => entry.skill);
  }

  remove(name: string): boolean {
    const path = this.file(name);
    if (!existsSync(path)) return false;
    rmSync(path);
    return true;
  }
}
