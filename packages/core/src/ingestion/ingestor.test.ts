import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HashEmbedder } from "../embeddings/hash-embedder.js";
import { Workspace } from "../lib/workspace.js";
import { StateStore } from "../state/store.js";
import { WorkspaceIngestor } from "./ingestor.js";

describe("WorkspaceIngestor", () => {
  let dir: string;
  let store: StateStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "anvil-ingest-"));
    store = StateStore.memory();
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ name: "shop", dependencies: { express: "4" } }),
    );
    mkdirSync(join(dir, "src"));
    writeFileSync(
      join(dir, "src", "checkout.ts"),
      "export function processPayment(amount: number) {\n  return amount * 1.2;\n}\n",
    );
    writeFileSync(
      join(dir, "src", "auth.ts"),
      "export function login(user: string) {\n  return `welcome ${user}`;\n}\n",
    );
  });

  afterEach(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("profiles the stack and indexes the code", async () => {
    const ingestor = new WorkspaceIngestor({ store, embedder: new HashEmbedder() });
    const result = await ingestor.ingest(new Workspace(dir));

    expect(result.profile.name).toBe("shop");
    expect(result.profile.stack.frameworks).toContain("express");
    expect(result.index.files).toBeGreaterThanOrEqual(2);
    expect(result.index.chunks).toBeGreaterThan(0);
    expect(existsSync(join(dir, ".anvil", "profile.json"))).toBe(true);
  });

  it("searches the indexed code semantically", async () => {
    const ingestor = new WorkspaceIngestor({ store, embedder: new HashEmbedder() });
    await ingestor.ingest(new Workspace(dir));
    const hits = await ingestor.search("amount paid at checkout");
    expect(hits[0]?.path).toBe("src/checkout.ts");
  });
});
