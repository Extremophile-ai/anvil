/**
 * The MCP bridge — exposes Anvil's ToolRegistry to the agent as an in-process
 * SDK MCP server. The agent calls Anvil tools (`mcp__anvil__write_file`, …)
 * instead of the SDK's built-in `Write`/`Edit`, so every change runs through
 * Anvil's audit + guardrails.
 *
 * Under the orchestrator, write tools are **auto-approved** (the orchestrator
 * is the implicit approver) but the full preview + audit is still emitted to
 * the bus, giving us the JSONL trail. The two-phase human approval flow
 * remains available via `ToolRegistry.call()` for CLI / interactive use.
 */
import {
  createSdkMcpServer,
  tool,
  type AnyZodRawShape,
  type McpSdkServerConfigWithInstance,
  type SdkMcpToolDefinition,
} from "@anthropic-ai/claude-agent-sdk";
import type { JobId } from "@anvil/shared";
import type { EventBus } from "../events/bus.js";
import { AnvilError } from "../lib/errors.js";
import type { Workspace } from "../lib/workspace.js";
import type { ToolRegistry } from "./registry.js";
import type { AnvilTool, ToolContext, ToolOutcome } from "./types.js";

export interface AnvilMcpBridgeDeps {
  registry: ToolRegistry;
  jobId: JobId;
  workspace: Workspace;
  bus: EventBus;
}

/** Matches the MCP SDK's CallToolResult shape — the index signature is what
 *  makes us structurally assignable to the SDK's strict type. */
interface BridgedResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
  [key: string]: unknown;
}

function asTextResult(text: string, isError = false): BridgedResult {
  const result: BridgedResult = { content: [{ type: "text", text }] };
  if (isError) result.isError = true;
  return result;
}

function formatOutcome(outcome: ToolOutcome): string {
  if (outcome.data === undefined) return outcome.summary;
  const json = JSON.stringify(outcome.data, null, 2);
  const trimmed = json.length > 6000 ? `${json.slice(0, 6000)}…` : json;
  return `${outcome.summary}\n\n${trimmed}`;
}

function shapeOf(anvilTool: AnvilTool): AnyZodRawShape {
  const schema = anvilTool.schema as unknown as { shape?: unknown };
  if (!schema.shape || typeof schema.shape !== "object") {
    throw new AnvilError(
      "TOOL_ERROR",
      `Cannot bridge "${anvilTool.name}": its schema must be a zod object.`,
    );
  }
  return schema.shape as unknown as AnyZodRawShape;
}

/** Bridge one Anvil tool into an SDK MCP tool definition. Exported for tests. */
export function bridgeTool(anvilTool: AnvilTool, deps: AnvilMcpBridgeDeps): SdkMcpToolDefinition {
  return tool(
    anvilTool.name,
    anvilTool.description,
    shapeOf(anvilTool),
    async (args, _extra) => {
      const ctx: ToolContext = {
        workspace: deps.workspace,
        jobId: deps.jobId,
        bus: deps.bus,
      };
      deps.bus.publish(deps.jobId, "tool.use", "info", `Tool: ${anvilTool.name}`, {
        tool: anvilTool.name,
        kind: anvilTool.kind,
        input: args,
      });

      if (anvilTool.kind === "read") {
        const outcome = await anvilTool.run(args, ctx);
        deps.bus.publish(
          deps.jobId,
          "tool.result",
          outcome.ok ? "debug" : "warn",
          `${anvilTool.name}: ${outcome.summary}`,
          { tool: anvilTool.name, ok: outcome.ok },
        );
        return asTextResult(formatOutcome(outcome), !outcome.ok);
      }

      // Write tool: build a preview for the audit trail, then auto-approve.
      const preview = await anvilTool.preview(args, ctx);
      deps.bus.publish(
        deps.jobId,
        "approval.granted",
        "info",
        `Auto-approved (orchestrator): ${preview.summary}`,
        { tool: anvilTool.name, preview: preview.summary },
      );
      const outcome = await anvilTool.execute(args, ctx);
      deps.bus.publish(
        deps.jobId,
        "tool.result",
        outcome.ok ? "info" : "error",
        `${anvilTool.name}: ${outcome.summary}`,
        { tool: anvilTool.name, ok: outcome.ok },
      );
      return asTextResult(formatOutcome(outcome), !outcome.ok);
    },
  );
}

const SERVER_NAME = "anvil";
const SERVER_VERSION = "0.0.0";

/** Build an in-process MCP server that exposes every tool in `registry`. */
export function createAnvilMcpServer(deps: AnvilMcpBridgeDeps): McpSdkServerConfigWithInstance {
  const tools = deps.registry.list().map((info) => {
    const anvilTool = deps.registry.get(info.name);
    if (!anvilTool) {
      throw new AnvilError("TOOL_ERROR", `Tool "${info.name}" disappeared from the registry.`);
    }
    return bridgeTool(anvilTool, deps);
  });
  return createSdkMcpServer({ name: SERVER_NAME, version: SERVER_VERSION, tools });
}
