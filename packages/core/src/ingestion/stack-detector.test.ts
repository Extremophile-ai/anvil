import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Workspace } from "../lib/workspace.js";
import { detectStack } from "./stack-detector.js";

describe("detectStack", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "anvil-stack-"));
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({
        name: "demo",
        packageManager: "pnpm@10.0.0",
        dependencies: { next: "15", express: "4" },
        devDependencies: { vitest: "2", typescript: "5" },
      }),
    );
    writeFileSync(join(dir, "tsconfig.json"), "{}");
    writeFileSync(join(dir, "pnpm-workspace.yaml"), "packages:\n  - packages/*\n");
    mkdirSync(join(dir, "src"));
    writeFileSync(join(dir, "src", "app.ts"), "export const x = 1;\n");
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("detects languages, package manager, frameworks, and monorepo", () => {
    const stack = detectStack(new Workspace(dir));
    expect(stack.languages).toContain("typescript");
    expect(stack.languages).toContain("javascript");
    expect(stack.packageManager).toBe("pnpm");
    expect(stack.frameworks).toEqual(expect.arrayContaining(["next", "express", "vitest"]));
    expect(stack.monorepo).toBe(true);
    expect(stack.runtimes).toContain("node");
  });
});
