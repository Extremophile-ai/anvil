import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

  it("returns a valid skill unchanged via get(name)", () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    library.save(makeSkill({ name: "valid-skill" }));
    const back = library.get("valid-skill");
    expect(back?.name).toBe("valid-skill");
    expect(back?.description).toBe("Render an invoice as a PDF document");
    expect(back?.capabilities).toEqual(["invoice", "pdf"]);
    expect(stderr).not.toHaveBeenCalled();
    stderr.mockRestore();
  });

  it("get(name) returns undefined and warns on an invalid hand-written skill", () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    // Hand-write a skill with empty description and no capabilities.
    const invalid = [
      "---",
      "id: skill_bad",
      "kind: skill",
      "description: ",
      "capabilities: []",
      "tags: []",
      "version: 1",
      "validated: true",
      "created: 2026-01-01T00:00:00.000Z",
      "updated: 2026-01-01T00:00:00.000Z",
      "---",
      "",
      "# Bad Skill\n\nThis is the body of a hand-edited skill that should fail validation.",
      "",
    ].join("\n");
    writeFileSync(join(dir, "bad-skill.skill.md"), invalid);

    const back = library.get("bad-skill");
    expect(back).toBeUndefined();
    expect(stderr).toHaveBeenCalledTimes(1);
    const message = String(stderr.mock.calls[0]?.[0] ?? "");
    expect(message).toMatch(/anvil: skipping invalid skill/);
    stderr.mockRestore();
  });

  it("list() drops invalid skills and warns exactly once for each", () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    library.save(makeSkill({ name: "good", capabilities: ["pdf"] }));
    const invalid = [
      "---",
      "id: skill_bad",
      "kind: skill",
      "description: ",
      "capabilities: []",
      "tags: []",
      "version: 1",
      "validated: true",
      "created: 2026-01-01T00:00:00.000Z",
      "updated: 2026-01-01T00:00:00.000Z",
      "---",
      "",
      "# Bad Skill\n\nThis is a hand-edited skill that should fail validation outright.",
      "",
    ].join("\n");
    writeFileSync(join(dir, "bad.skill.md"), invalid);

    const skills = library.list();
    expect(skills.length).toBe(1);
    expect(skills[0]?.name).toBe("good");
    expect(stderr).toHaveBeenCalledTimes(1);
    const message = String(stderr.mock.calls[0]?.[0] ?? "");
    expect(message).toMatch(/anvil: skipping invalid skill "bad"/);
    stderr.mockRestore();
  });

  it("get(name) on a file with corrupt/missing frontmatter is skipped without crashing", () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    // No frontmatter delimiters at all — parseDocument yields empty frontmatter,
    // which means missing description and no capabilities, so validation must
    // skip it cleanly instead of throwing.
    writeFileSync(join(dir, "corrupt.skill.md"), "this is not a valid skill file at all");

    expect(() => library.get("corrupt")).not.toThrow();
    const back = library.get("corrupt");
    expect(back).toBeUndefined();
    expect(stderr).toHaveBeenCalled();
    stderr.mockRestore();
  });
});
