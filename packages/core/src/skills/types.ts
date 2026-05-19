/**
 * Types for the skill factory — the harness's self-extension. When Anvil needs
 * a capability it lacks, it generates one, validates it, and registers it in
 * the global library.
 */

export type SkillKind = "skill" | "tool" | "plugin";

/** A request for a capability the harness does not yet have. */
export interface SkillRequest {
  /** The capability needed, in plain language. */
  need: string;
  kind?: SkillKind;
  /** Extra context to inform generation (project profile, related facts). */
  context?: string;
}

/** A freshly generated skill, before it is validated and registered. */
export interface SkillDraft {
  /** Kebab-case slug — also the file name. */
  name: string;
  kind: SkillKind;
  description: string;
  /** Markdown instructions (skill/plugin) or source code (tool). */
  content: string;
  capabilities: string[];
  tags: string[];
}

/** A registered library skill. */
export interface Skill extends SkillDraft {
  id: string;
  version: number;
  validated: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Generates a skill draft for a request. */
export interface SkillGenerator {
  generate(request: SkillRequest): Promise<SkillDraft>;
}

export interface SkillValidation {
  ok: boolean;
  issues: string[];
}
