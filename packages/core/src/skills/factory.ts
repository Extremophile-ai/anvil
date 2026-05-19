/**
 * The skill factory — Anvil's self-extension. Given a capability the harness
 * lacks, it generates a skill, validates it, and registers the passing result
 * in the global library. The next run inherits it.
 */
import { randomUUID } from "node:crypto";
import type { JobId } from "@anvil/shared";
import type { EventBus } from "../events/bus.js";
import { TemplateSkillGenerator } from "./generator.js";
import type { SkillLibrary } from "./library.js";
import type { Skill, SkillGenerator, SkillRequest, SkillValidation } from "./types.js";
import { validateSkill } from "./validate.js";

export interface SkillFactoryDeps {
  library: SkillLibrary;
  /** Defaults to the deterministic template generator. */
  generator?: SkillGenerator;
  bus?: EventBus;
}

export interface SkillCreation {
  skill: Skill;
  validation: SkillValidation;
  /** True when the skill passed validation and was saved to the library. */
  registered: boolean;
}

export interface SkillAcquisition {
  skill: Skill;
  /** True when the skill was freshly generated rather than already in library. */
  created: boolean;
}

export class SkillFactory {
  private readonly library: SkillLibrary;
  private readonly generator: SkillGenerator;
  private readonly bus: EventBus | undefined;

  constructor(deps: SkillFactoryDeps) {
    this.library = deps.library;
    this.generator = deps.generator ?? new TemplateSkillGenerator();
    this.bus = deps.bus;
  }

  /** Validated library skills that already cover a need. */
  find(need: string): Skill[] {
    return this.library.search(need).filter((skill) => skill.validated);
  }

  /** Generate a skill for a need, validate it, and register it if it passes. */
  async create(request: SkillRequest, jobId?: JobId): Promise<SkillCreation> {
    const draft = await this.generator.generate(request);
    const validation = validateSkill(draft);
    const now = new Date().toISOString();
    const existing = this.library.get(draft.name);
    const skill: Skill = {
      ...draft,
      id: existing?.id ?? `skill_${randomUUID()}`,
      version: existing ? existing.version + 1 : 1,
      validated: validation.ok,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    if (validation.ok) {
      this.library.save(skill);
      if (this.bus && jobId) {
        this.bus.publish(jobId, "skill.created", "info", `Registered skill "${skill.name}" (v${skill.version}).`, {
          name: skill.name,
          kind: skill.kind,
        });
      }
    }
    return { skill, validation, registered: validation.ok };
  }

  /** Reuse an existing library skill for a need, or generate a new one. */
  async acquire(request: SkillRequest, jobId?: JobId): Promise<SkillAcquisition> {
    const [existing] = this.find(request.need);
    if (existing) return { skill: existing, created: false };
    const { skill } = await this.create(request, jobId);
    return { skill, created: true };
  }
}
