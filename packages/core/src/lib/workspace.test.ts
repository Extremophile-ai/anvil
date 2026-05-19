import path from "node:path";
import { describe, expect, it } from "vitest";
import { Workspace } from "./workspace.js";

describe("Workspace", () => {
  const ws = new Workspace("/tmp/anvil-ws");

  it("resolves paths inside the root", () => {
    expect(ws.resolve("src/index.ts")).toBe(path.join("/tmp/anvil-ws", "src/index.ts"));
    expect(ws.resolve(".")).toBe("/tmp/anvil-ws");
  });

  it("rejects traversal outside the root", () => {
    expect(() => ws.resolve("../secrets")).toThrow(/outside the workspace/);
    expect(() => ws.resolve("/etc/passwd")).toThrow(/outside the workspace/);
  });

  it("reports containment", () => {
    expect(ws.contains("/tmp/anvil-ws/a/b")).toBe(true);
    expect(ws.contains("/tmp/other")).toBe(false);
  });
});
