import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HashEmbedder } from "../embeddings/hash-embedder.js";
import { StateStore } from "../state/store.js";
import { MemoryManager } from "./manager.js";

describe("MemoryManager", () => {
  let dir: string;
  let store: StateStore;
  let memory: MemoryManager;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "anvil-mem-"));
    store = StateStore.memory();
    memory = new MemoryManager({
      store,
      embedder: new HashEmbedder(),
      projectDir: join(dir, "project"),
      globalDir: join(dir, "global"),
    });
  });

  afterEach(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("remembers a fact and recalls it semantically", async () => {
    await memory.remember({
      description: "Deployment uses Docker",
      body: "Every service runs inside a Docker container.",
      type: "project",
    });
    const hits = await memory.recall("how are the services deployed with docker containers");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]?.fact.description).toBe("Deployment uses Docker");
  });

  it("dedupes a near-identical fact into an update", async () => {
    await memory.remember({ description: "Use pnpm", body: "The package manager is pnpm.", type: "project" });
    await memory.remember({ description: "Use pnpm", body: "The package manager is pnpm.", type: "project" });
    expect(memory.list("project").length).toBe(1);
  });

  it("forgets a fact everywhere", async () => {
    const fact = await memory.remember({
      description: "Temporary note",
      body: "This will be removed.",
      type: "project",
    });
    expect(memory.forget(fact.name, "project")).toBe(true);
    expect(memory.get(fact.name, "project")).toBeUndefined();
  });

  it("rebuilds the index from files via reindex", async () => {
    await memory.remember({ description: "Persisted fact", body: "Stored on disk.", type: "project" });
    const count = await memory.reindex();
    expect(count).toBe(1);
    const hits = await memory.recall("persisted fact stored on disk");
    expect(hits.length).toBe(1);
  });
});
