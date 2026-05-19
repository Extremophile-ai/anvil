import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { newJobId } from "@anvil/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EventBus } from "../events/bus.js";
import { Workspace } from "../lib/workspace.js";
import { builtinTools } from "./builtins/index.js";
import { ToolRegistry } from "./registry.js";

describe("ToolRegistry with the built-in tools", () => {
  let dir: string;
  let registry: ToolRegistry;
  const jobId = newJobId();

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "anvil-tools-"));
    writeFileSync(join(dir, "existing.txt"), "hello\n");
    registry = new ToolRegistry({ workspace: new Workspace(dir), bus: new EventBus() });
    registry.registerAll(builtinTools());
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("runs a read tool immediately", async () => {
    const result = await registry.call(jobId, "read_file", { path: "existing.txt" });
    expect(result.status).toBe("completed");
    if (result.status === "completed") {
      expect(result.outcome.ok).toBe(true);
      expect((result.outcome.data as { content: string }).content).toBe("hello\n");
    }
  });

  it("requires approval before a write tool changes anything", async () => {
    const result = await registry.call(jobId, "write_file", { path: "new.txt", content: "fresh" });
    expect(result.status).toBe("approval-required");
    expect(existsSync(join(dir, "new.txt"))).toBe(false);

    if (result.status === "approval-required") {
      const outcome = await registry.approve(jobId, result.token);
      expect(outcome.ok).toBe(true);
    }
    expect(readFileSync(join(dir, "new.txt"), "utf8")).toBe("fresh");
  });

  it("rejects an unknown tool with an actionable error", async () => {
    await expect(registry.call(jobId, "frobnicate", {})).rejects.toThrow(
      /Unknown tool.*Available tools/,
    );
  });

  it("rejects invalid input", async () => {
    await expect(registry.call(jobId, "read_file", { wrong: 1 })).rejects.toThrow(/Invalid input/);
  });

  it("removes files to the trash rather than deleting them", async () => {
    const result = await registry.call(jobId, "delete_file", { path: "existing.txt" });
    if (result.status === "approval-required") await registry.approve(jobId, result.token);
    expect(existsSync(join(dir, "existing.txt"))).toBe(false);
    expect(existsSync(join(dir, ".anvil", "trash"))).toBe(true);
  });

  it("blocks path traversal outside the workspace", async () => {
    await expect(registry.call(jobId, "read_file", { path: "../../../etc/passwd" })).rejects.toThrow(
      /outside the workspace/,
    );
  });
});
