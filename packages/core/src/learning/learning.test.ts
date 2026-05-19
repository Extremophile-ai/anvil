import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { newJobId } from "@anvil/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HashEmbedder } from "../embeddings/hash-embedder.js";
import { MemoryManager } from "../memory/manager.js";
import { StateStore } from "../state/store.js";
import { LearningLoop } from "./loop.js";

describe("LearningLoop", () => {
  let dir: string;
  let store: StateStore;
  let memory: MemoryManager;
  let loop: LearningLoop;
  let failuresPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "anvil-learn-"));
    store = StateStore.memory();
    memory = new MemoryManager({
      store,
      embedder: new HashEmbedder(),
      projectDir: join(dir, "project"),
      globalDir: join(dir, "global"),
    });
    failuresPath = join(dir, "failures.md");
    loop = new LearningLoop({ store, memory, failuresPath });
  });

  afterEach(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("logs a failure, seeds a regression eval, and remembers the fix", async () => {
    const { failure, evalCase } = await loop.logFailure({
      whatHappened: "Wrote a component into the wrong directory",
      rootCause: "Guessed the project conventions instead of checking them",
      fixApplied: "Moved the file to the components directory",
      harnessImprovement: "Add a scaffold tool that knows the correct directory",
      severity: "medium",
    });

    expect(loop.failures.count()).toBe(1);
    expect(loop.evals.get(evalCase.id)?.sourceFailureId).toBe(failure.id);
    expect(existsSync(failuresPath)).toBe(true);
    expect(readFileSync(failuresPath, "utf8")).toContain("wrong directory");
    expect((await memory.recall("component wrong directory conventions")).length).toBeGreaterThan(0);
  });

  it("reflects corrections into memory", async () => {
    const result = await loop.reflect({
      jobId: newJobId(),
      task: "Build the login page",
      outcome: "success",
      corrections: ["Use the design system tokens, never hard-coded colors"],
    });
    expect(result.lessons.length).toBe(1);
    expect(result.remembered.length).toBe(1);
    expect((await memory.recall("design system tokens colors")).length).toBeGreaterThan(0);
  });

  it("adds a post-mortem lesson when a run failed", async () => {
    const result = await loop.reflect({
      jobId: newJobId(),
      task: "Deploy the service",
      outcome: "failure",
      corrections: [],
      notes: ["The Docker build failed"],
    });
    expect(result.lessons.length).toBe(1);
    expect(result.lessons[0]?.tags).toContain("post-mortem");
  });
});
