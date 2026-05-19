import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Workspace } from "../lib/workspace.js";
import { LocalSandbox } from "./local.js";

describe("LocalSandbox", () => {
  let dir: string;
  let sandbox: LocalSandbox;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "anvil-local-sb-"));
    sandbox = new LocalSandbox({ workspace: new Workspace(dir) });
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("runs a command in the workspace", async () => {
    const result = await sandbox.exec("node", ["-e", "process.stdout.write('hello')"]);
    expect(result.code).toBe(0);
    expect(result.stdout).toBe("hello");
  });

  it("captures a non-zero exit code", async () => {
    const result = await sandbox.exec("node", ["-e", "process.exit(7)"]);
    expect(result.code).toBe(7);
  });

  it("rejects a cwd outside the workspace", async () => {
    await expect(sandbox.exec("echo", ["x"], { cwd: "../outside" })).rejects.toThrow(
      /outside the workspace/,
    );
  });
});
