/**
 * Per-skill validation — the eval a generated skill must pass before it is
 * registered. A skill that fails here is never marked usable.
 */
import type { SkillDraft, SkillValidation } from "./types.js";

export function validateSkill(draft: SkillDraft): SkillValidation {
  const issues: string[] = [];

  if (!/^[a-z0-9][a-z0-9-]*$/.test(draft.name)) {
    issues.push("name must be a kebab-case slug");
  }
  if (draft.description.trim().length < 8) {
    issues.push("description is too short to be useful");
  }
  if (draft.content.trim().length < 20) {
    issues.push("content is too short to be a real skill");
  }
  if (draft.capabilities.length === 0) {
    issues.push("at least one capability tag is required");
  }
  if (draft.kind === "tool" && !/\bexport\b/.test(draft.content)) {
    issues.push("a tool skill must export something");
  }

  return { ok: issues.length === 0, issues };
}
