import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SkillLibrary } from "./library.js";
import type { Skill } from "./types.js";

function makeSkill(overrides: Partial<Skill> = {}): Skill {
  return {
    id: "skill_test",
    name: "render-invoice",
    kind: "skill",
    description: "Render an invoice as a PDF document",
    content: "# Render Invoice\n\nProduce a well-formed invoice PDF here.",
    capabilities: ["invoice", "pdf"],
    tags: ["skill", "invoice"],
    version: 1,
    validated: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("SkillLibrary", () => {
  let dir: string;
  let library: SkillLibrary;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "anvil-skills-"));
    library = new SkillLibrary(dir);
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("saves and reads back a skill", () => {
    library.save(makeSkill());
    const back = library.get("render-invoice");
    expect(back?.description).toBe("Render an invoice as a PDF document");
    expect(back?.capabilities).toEqual(["invoice", "pdf"]);
    expect(back?.validated).toBe(true);
  });

  it("searches by capability, best match first", () => {
    library.save(makeSkill({ name: "a", capabilities: ["pdf", "invoice"] }));
    library.save(makeSkill({ name: "b", capabilities: ["email"] }));
    expect(library.search("invoice pdf")[0]?.name).toBe("a");
  });

  it("lists and removes skills", () => {
    library.save(makeSkill({ name: "one" }));
    library.save(makeSkill({ name: "two" }));
    expect(library.list().length).toBe(2);
    expect(library.remove("one")).toBe(true);
    expect(library.list().length).toBe(1);
  });
});
