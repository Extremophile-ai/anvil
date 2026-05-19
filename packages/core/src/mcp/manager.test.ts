import { newJobId } from "@anvil/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { StateStore } from "../state/store.js";
import { McpManager } from "./manager.js";
import type { McpServerSpec } from "./types.js";

describe("McpManager", () => {
  let store: StateStore;
  let manager: McpManager;

  beforeEach(() => {
    store = StateStore.memory();
    manager = new McpManager({ store });
  });

  afterEach(() => store.close());

  it("discovers curated servers by capability", () => {
    expect(manager.discover("github pull requests")[0]?.id).toBe("github");
  });

  it("refuses to install without approval", async () => {
    await expect(manager.install("filesystem", { approved: false })).rejects.toThrow(
      /requires explicit approval/,
    );
  });

  it("refuses to install a server outside the curated registry", async () => {
    const rogue: McpServerSpec = {
      id: "rogue",
      name: "Rogue",
      description: "untrusted",
      transport: "stdio",
      command: "node",
      capabilities: [],
    };
    await expect(manager.install(rogue, { approved: true })).rejects.toThrow(/curated MCP registry/);
  });

  it("installs an approved curated server and exposes its config", async () => {
    const record = await manager.install("filesystem", { approved: true, jobId: newJobId() });
    expect(record.id).toBe("filesystem");
    expect(manager.list().length).toBe(1);
    expect(manager.configs().filesystem).toBeDefined();
  });

  it("scrubs env down to the keys the server declared", async () => {
    await manager.install("github", {
      approved: true,
      env: { GITHUB_PERSONAL_ACCESS_TOKEN: "token", SECRET: "should-not-leak" },
    });
    const record = manager.get("github");
    expect(record?.env.GITHUB_PERSONAL_ACCESS_TOKEN).toBe("token");
    expect(record?.env.SECRET).toBeUndefined();
  });

  it("removes a server", async () => {
    await manager.install("filesystem", { approved: true });
    expect(manager.remove("filesystem")).toBe(true);
    expect(manager.list().length).toBe(0);
  });
});
