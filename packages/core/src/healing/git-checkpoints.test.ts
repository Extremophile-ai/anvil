import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GitCheckpoints } from "./git-checkpoints.js";

describe("GitCheckpoints", () => {
  let dir: string;
  const git = (...args: string[]): void => {
    execFileSync("git", args, { cwd: dir });
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "anvil-git-"));
    git("init", "-q");
    git("config", "user.email", "test@anvil.dev");
    git("config", "user.name", "Anvil Test");
    writeFileSync(join(dir, "file.txt"), "original\n");
    git("add", "-A");
    git("commit", "-q", "-m", "initial");
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("detects a git working tree", async () => {
    expect(await new GitCheckpoints(dir).isRepo()).toBe(true);
  });

  it("restores tracked changes and removes files created after the checkpoint", async () => {
    const checkpoints = new GitCheckpoints(dir);
    const checkpoint = await checkpoints.checkpoint("before risky step");

    writeFileSync(join(dir, "file.txt"), "corrupted by the agent\n");
    writeFileSync(join(dir, "stray.txt"), "should not survive a rollback\n");

    await checkpoints.restore(checkpoint.id);

    expect(readFileSync(join(dir, "file.txt"), "utf8")).toBe("original\n");
    expect(existsSync(join(dir, "stray.txt"))).toBe(false);
  });

  it("lists and clears checkpoints", async () => {
    const checkpoints = new GitCheckpoints(dir);
    await checkpoints.checkpoint("one");
    expect((await checkpoints.list()).length).toBe(1);
    await checkpoints.clear();
    expect((await checkpoints.list()).length).toBe(0);
  });
});
