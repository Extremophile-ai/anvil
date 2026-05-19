/**
 * The tool model. A tool is executable infrastructure the agent calls instead
 * of touching the filesystem or shell directly. Read tools run freely; write
 * tools are two-phase — `preview` first, then `execute` only with approval.
 */
import type { z } from "zod";
import type { JobId } from "@anvil/shared";
import type { EventBus } from "../events/bus.js";
import type { Workspace } from "../lib/workspace.js";

export type ToolKind = "read" | "write";

export interface ToolContext {
  workspace: Workspace;
  jobId: JobId;
  bus: EventBus;
}

export interface ToolOutcome {
  ok: boolean;
  /** Actionable, human-readable summary — what happened, or why it failed. */
  summary: string;
  data?: unknown;
}

export interface ToolPreview {
  /** Exactly what executing the tool will do. */
  summary: string;
  details?: Record<string, unknown>;
}

interface ToolBase {
  name: string;
  description: string;
  schema: z.ZodType;
}

export interface ReadTool extends ToolBase {
  kind: "read";
  run(input: unknown, ctx: ToolContext): Promise<ToolOutcome>;
}

export interface WriteTool extends ToolBase {
  kind: "write";
  /** Phase one — describe the change without making it. */
  preview(input: unknown, ctx: ToolContext): Promise<ToolPreview>;
  /** Phase two — perform the change. Reached only via an approved token. */
  execute(input: unknown, ctx: ToolContext): Promise<ToolOutcome>;
}

export type AnvilTool = ReadTool | WriteTool;

/** Define a read tool with a typed input derived from its zod schema. */
export function defineReadTool<S extends z.ZodType>(def: {
  name: string;
  description: string;
  schema: S;
  run: (input: z.infer<S>, ctx: ToolContext) => Promise<ToolOutcome>;
}): ReadTool {
  return {
    name: def.name,
    description: def.description,
    schema: def.schema,
    kind: "read",
    run: (input, ctx) => def.run(def.schema.parse(input), ctx),
  };
}

/** Define a two-phase write tool with a typed input derived from its schema. */
export function defineWriteTool<S extends z.ZodType>(def: {
  name: string;
  description: string;
  schema: S;
  preview: (input: z.infer<S>, ctx: ToolContext) => Promise<ToolPreview>;
  execute: (input: z.infer<S>, ctx: ToolContext) => Promise<ToolOutcome>;
}): WriteTool {
  return {
    name: def.name,
    description: def.description,
    schema: def.schema,
    kind: "write",
    preview: (input, ctx) => def.preview(def.schema.parse(input), ctx),
    execute: (input, ctx) => def.execute(def.schema.parse(input), ctx),
  };
}
