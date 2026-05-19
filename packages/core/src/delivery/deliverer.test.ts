import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CommandResult } from "../lib/exec.js";
import { Workspace } from "../lib/workspace.js";
import { Deliverer } from "./deliverer.js";

describe("Deliverer (real git in a temp repo)", () => {
  let dir: string;
  let deliverer: Deliverer;
  const git = (...args: string[]): void => {
    execFileSync("git", args, { cwd: dir });
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "anvil-deliver-"));
    git("init", "-q", "-b", "main");
    git("config", "user.email", "test@anvil.dev");
    git("config", "user.name", "Anvil Test");
    writeFileSync(join(dir, "README.md"), "# hi\n");
    git("add", "-A");
    git("commit", "-q", "-m", "initial");
    deliverer = new Deliverer({ workspace: new Workspace(dir) });
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("detects the repo and the default branch", async () => {
    expect(await deliverer.isRepo()).toBe(true);
    expect(await deliverer.defaultBranch()).toBe("main");
  });

  it("reads the current branch and clean state", async () => {
    expect(await deliverer.currentBranch()).toBe("main");
    expect(await deliverer.isClean()).toBe(true);
  });

  it("refuses to use the default branch as a feature branch", async () => {
    await expect(deliverer.startBranch("main")).rejects.toThrow(/default branch/);
  });

  it("creates a feature branch and commits onto it", async () => {
    await deliverer.startBranch("feature/anvil-1");
    expect(await deliverer.currentBranch()).toBe("feature/anvil-1");
    writeFileSync(join(dir, "src.ts"), "export const x = 1;\n");
    const sha = await deliverer.commit("anvil: add src");
    expect(sha).toMatch(/^[0-9a-f]{40}$/);
    expect(await deliverer.isClean()).toBe(true);
  });

  it("refuses to push directly to the default branch", async () => {
    await expect(deliverer.push()).rejects.toThrow(/default branch/);
  });
});

interface RecordedCall {
  command: string;
  args: string[];
}

describe("Deliverer.openPullRequest (mocked gh)", () => {
  it("invokes gh pr create with the right flags", async () => {
    const calls: RecordedCall[] = [];
    const runner = (command: string, args: string[]): Promise<CommandResult> => {
      calls.push({ command, args });
      return Promise.resolve({
        code: 0,
        stdout: "https://github.com/example/repo/pull/42",
        stderr: "",
      });
    };
    const deliverer = new Deliverer({ workspace: new Workspace("/tmp/x"), runner });
    const url = await deliverer.openPullRequest({
      title: "Add feature",
      body: "Built by Anvil.",
      base: "main",
      draft: true,
    });
    expect(url).toBe("https://github.com/example/repo/pull/42");
    expect(calls[0]?.command).toBe("gh");
    expect(calls[0]?.args).toEqual([
      "pr",
      "create",
      "--title",
      "Add feature",
      "--body",
      "Built by Anvil.",
      "--base",
      "main",
      "--draft",
    ]);
  });

  it("surfaces a clear error when gh fails", async () => {
    const runner = (): Promise<CommandResult> =>
      Promise.resolve({ code: 1, stdout: "", stderr: "auth required" });
    const deliverer = new Deliverer({ workspace: new Workspace("/tmp/x"), runner });
    await expect(
      deliverer.openPullRequest({ title: "T", body: "B" }),
    ).rejects.toThrow(/gh pr create failed/);
  });
});
