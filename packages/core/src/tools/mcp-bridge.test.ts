import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { newJobId } from "@anvil/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EventBus } from "../events/bus.js";
import { Workspace } from "../lib/workspace.js";
import { builtinTools } from "./builtins/index.js";
import { bridgeTool, createAnvilMcpServer } from "./mcp-bridge.js";
import { ToolRegistry } from "./registry.js";

describe("AnvilMcpBridge", () => {
  let dir: string;
  let registry: ToolRegistry;
  let bus: EventBus;
  let events: string[];

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "anvil-bridge-"));
    bus = new EventBus();
    events = [];
    bus.on((event) => events.push(event.kind));
    registry = new ToolRegistry({ workspace: new Workspace(dir), bus });
    registry.registerAll(builtinTools());
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  // The bridged handler's input is loosely typed by the SDK — for testing we
  // call it through a structural alias that accepts our concrete args.
  type LooseHandler = (
    args: Record<string, unknown>,
    extra: unknown,
  ) => Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }>;

  it("bridges a write tool and auto-approves it through the orchestrator", async () => {
    const writeTool = registry.get("write_file");
    if (!writeTool) throw new Error("write_file missing");
    const bridged = bridgeTool(writeTool, { registry, jobId: newJobId(), workspace: new Workspace(dir), bus });
    const handler = bridged.handler as unknown as LooseHandler;

    const result = await handler({ path: "hello.txt", content: "hi" }, {});
    expect(result.isError).toBeUndefined();
    expect(existsSync(join(dir, "hello.txt"))).toBe(true);
    expect(readFileSync(join(dir, "hello.txt"), "utf8")).toBe("hi");
    expect(events).toContain("tool.use");
    expect(events).toContain("approval.granted");
    expect(events).toContain("tool.result");
  });

  it("bridges a read tool and runs it freely", async () => {
    const readTool = registry.get("read_file");
    const writeTool = registry.get("write_file");
    if (!readTool || !writeTool) throw new Error("builtin tools missing");

    const write = bridgeTool(writeTool, { registry, jobId: newJobId(), workspace: new Workspace(dir), bus })
      .handler as unknown as LooseHandler;
    await write({ path: "x.txt", content: "alpha" }, {});

    const read = bridgeTool(readTool, { registry, jobId: newJobId(), workspace: new Workspace(dir), bus })
      .handler as unknown as LooseHandler;
    const result = await read({ path: "x.txt" }, {});

    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text).toContain("alpha");
  });

  it("creates an MCP server config with all registered tools", () => {
    const server = createAnvilMcpServer({
      registry,
      jobId: newJobId(),
      workspace: new Workspace(dir),
      bus,
    });
    expect(server.type).toBe("sdk");
    expect(server.name).toBe("anvil");
    expect(server.instance).toBeDefined();
  });
});
