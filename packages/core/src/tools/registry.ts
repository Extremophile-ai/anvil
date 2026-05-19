/**
 * The tool registry — the single dispatch point for every tool call. It
 * validates input, logs every call as a JSONL event, runs read tools directly,
 * and routes write tools through two-phase approval.
 */
import { type ApprovalToken, type JobId } from "@anvil/shared";
import { z } from "zod";
import type { EventBus } from "../events/bus.js";
import { AnvilError, errorMessage } from "../lib/errors.js";
import type { Workspace } from "../lib/workspace.js";
import { ApprovalRegistry } from "./approval.js";
import type { AnvilTool, ToolContext, ToolKind, ToolOutcome, ToolPreview } from "./types.js";

export interface ToolInfo {
  name: string;
  kind: ToolKind;
  description: string;
}

export type ToolCallResult =
  | { status: "completed"; outcome: ToolOutcome }
  | { status: "approval-required"; token: ApprovalToken; preview: ToolPreview };

export interface ToolRegistryDeps {
  workspace: Workspace;
  bus: EventBus;
  approvals?: ApprovalRegistry;
}

export class ToolRegistry {
  private readonly tools = new Map<string, AnvilTool>();
  private readonly workspace: Workspace;
  private readonly bus: EventBus;
  readonly approvals: ApprovalRegistry;

  constructor(deps: ToolRegistryDeps) {
    this.workspace = deps.workspace;
    this.bus = deps.bus;
    this.approvals = deps.approvals ?? new ApprovalRegistry();
  }

  register(tool: AnvilTool): void {
    if (this.tools.has(tool.name)) {
      throw new AnvilError("INVALID_INPUT", `A tool named "${tool.name}" is already registered.`);
    }
    this.tools.set(tool.name, tool);
  }

  registerAll(tools: readonly AnvilTool[]): void {
    for (const tool of tools) this.register(tool);
  }

  get(name: string): AnvilTool | undefined {
    return this.tools.get(name);
  }

  list(): ToolInfo[] {
    return [...this.tools.values()].map((tool) => ({
      name: tool.name,
      kind: tool.kind,
      description: tool.description,
    }));
  }

  /**
   * Invoke a tool. Read tools run and return their result. Write tools return
   * a preview and an approval token — nothing has changed yet.
   */
  async call(jobId: JobId, name: string, input: unknown): Promise<ToolCallResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      const available = [...this.tools.keys()].sort().join(", ") || "(none registered)";
      throw new AnvilError("TOOL_ERROR", `Unknown tool "${name}". Available tools: ${available}.`);
    }

    const parsed = this.parseInput(name, tool, input);
    this.bus.publish(jobId, "tool.use", "info", `Tool: ${name}`, {
      tool: name,
      kind: tool.kind,
      input: parsed,
    });
    const ctx: ToolContext = { workspace: this.workspace, jobId, bus: this.bus };

    if (tool.kind === "read") {
      const outcome = await tool.run(parsed, ctx);
      this.bus.publish(jobId, "tool.result", outcome.ok ? "debug" : "warn", `${name}: ${outcome.summary}`, {
        tool: name,
        ok: outcome.ok,
      });
      return { status: "completed", outcome };
    }

    const preview = await tool.preview(parsed, ctx);
    const approval = this.approvals.issue(name, parsed, preview, jobId);
    this.bus.publish(jobId, "approval.requested", "info", `Approval required for "${name}": ${preview.summary}`, {
      tool: name,
      token: approval.token,
    });
    return { status: "approval-required", token: approval.token, preview };
  }

  /** Execute a previously-previewed write tool, using its approval token. */
  async approve(jobId: JobId, token: string): Promise<ToolOutcome> {
    const approval = this.approvals.redeem(token);
    const tool = this.tools.get(approval.tool);
    if (!tool || tool.kind !== "write") {
      throw new AnvilError("TOOL_ERROR", `The approved tool "${approval.tool}" is no longer available.`);
    }
    const ctx: ToolContext = { workspace: this.workspace, jobId, bus: this.bus };
    this.bus.publish(jobId, "approval.granted", "info", `Executing "${approval.tool}".`, {
      tool: approval.tool,
    });
    const outcome = await tool.execute(approval.input, ctx);
    this.bus.publish(jobId, "tool.result", outcome.ok ? "info" : "error", `${approval.tool}: ${outcome.summary}`, {
      tool: approval.tool,
      ok: outcome.ok,
    });
    return outcome;
  }

  private parseInput(name: string, tool: AnvilTool, input: unknown): unknown {
    try {
      return tool.schema.parse(input);
    } catch (err) {
      const detail =
        err instanceof z.ZodError
          ? err.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`).join("; ")
          : errorMessage(err);
      throw new AnvilError("INVALID_INPUT", `Invalid input for "${name}": ${detail}`);
    }
  }
}
