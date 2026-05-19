import { describe, expect, it } from "vitest";
import { McpRegistry } from "./registry.js";

describe("McpRegistry", () => {
  it("seeds the curated catalog", () => {
    const registry = new McpRegistry();
    expect(registry.has("filesystem")).toBe(true);
    expect(registry.all().length).toBeGreaterThan(3);
  });

  it("searches by capability, best match first", () => {
    const hits = new McpRegistry().search("browser end-to-end testing");
    expect(hits[0]?.id).toBe("playwright");
  });

  it("returns nothing for an unknown capability", () => {
    expect(new McpRegistry().search("quantum teleportation").length).toBe(0);
  });
});
