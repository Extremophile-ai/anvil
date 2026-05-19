import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SkillFactory } from "./factory.js";
import { SkillLibrary } from "./library.js";

describe("SkillFactory", () => {
  let dir: string;
  let library: SkillLibrary;
  let factory: SkillFactory;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "anvil-factory-"));
    library = new SkillLibrary(dir);
    factory = new SkillFactory({ library });
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("generates, validates, and registers a skill", async () => {
    const { skill, registered } = await factory.create({ need: "generate a sitemap for a website" });
    expect(registered).toBe(true);
    expect(skill.validated).toBe(true);
    expect(library.has(skill.name)).toBe(true);
  });

  it("generates a tool skill that exports something", async () => {
    const { skill, validation } = await factory.create({
      need: "count the words in a document",
      kind: "tool",
    });
    expect(validation.ok).toBe(true);
    expect(skill.content).toContain("export");
  });

  it("reuses an existing skill instead of regenerating it", async () => {
    const first = await factory.acquire({ need: "generate a sitemap for a website" });
    expect(first.created).toBe(true);
    const second = await factory.acquire({ need: "generate a sitemap for a website" });
    expect(second.created).toBe(false);
    expect(second.skill.name).toBe(first.skill.name);
  });

  it("bumps the version when a skill is recreated", async () => {
    const v1 = await factory.create({ need: "build a contact form" });
    const v2 = await factory.create({ need: "build a contact form" });
    expect(v2.skill.version).toBe(v1.skill.version + 1);
  });
});
