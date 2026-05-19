/**
 * The plan — how the orchestrator represents a task it is about to build. A
 * plan is a DAG of nodes (epics, tasks, steps); the orchestrator executes
 * nodes in dependency order.
 */
import { z } from "zod";

export type PlanNodeKind = "epic" | "task" | "step";

export type PlanNodeStatus = "pending" | "running" | "blocked" | "done" | "failed" | "skipped";

/** Which part of the product a node builds. */
export type PlanSurface = "frontend" | "backend" | "shared" | "infra";

export interface PlanNode {
  id: string;
  title: string;
  description: string;
  kind: PlanNodeKind;
  /** Ids of nodes that must finish before this one may start. */
  dependencies: string[];
  status: PlanNodeStatus;
  surface?: PlanSurface;
  /** A short summary of what was done, filled in once the node completes. */
  result?: string;
}

export interface Plan {
  /** The overall goal the plan delivers. */
  goal: string;
  nodes: PlanNode[];
}

export const planNodeSchema = z.strictObject({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().default(""),
  kind: z.enum(["epic", "task", "step"]).default("task"),
  dependencies: z.array(z.string()).default([]),
  status: z
    .enum(["pending", "running", "blocked", "done", "failed", "skipped"])
    .default("pending"),
  surface: z.enum(["frontend", "backend", "shared", "infra"]).optional(),
  result: z.string().optional(),
});

export const planSchema = z.strictObject({
  goal: z.string().min(1),
  nodes: z.array(planNodeSchema),
});
