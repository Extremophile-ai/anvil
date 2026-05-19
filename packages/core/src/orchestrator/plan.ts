/**
 * Plan helpers — pure functions over the plan DAG: dependency ordering, which
 * nodes are ready to run, progress, and completion.
 */
import type { Plan, PlanNode, PlanNodeStatus } from "@anvil/shared";
import { AnvilError } from "../lib/errors.js";

const TERMINAL: ReadonlySet<PlanNodeStatus> = new Set(["done", "skipped"]);

export function createPlan(goal: string, nodes: PlanNode[]): Plan {
  return { goal, nodes };
}

export function nodeById(plan: Plan, id: string): PlanNode | undefined {
  return plan.nodes.find((node) => node.id === id);
}

/** Nodes ready to run: pending, with every dependency already done. */
export function readyNodes(plan: Plan): PlanNode[] {
  return plan.nodes.filter(
    (node) =>
      node.status === "pending" &&
      node.dependencies.every((dep) => nodeById(plan, dep)?.status === "done"),
  );
}

/** The plan's nodes in dependency order. Throws on a cycle or missing dep. */
export function topologicalOrder(plan: Plan): PlanNode[] {
  const byId = new Map(plan.nodes.map((node) => [node.id, node]));
  const indegree = new Map<string, number>(plan.nodes.map((node) => [node.id, 0]));
  for (const node of plan.nodes) {
    for (const dep of node.dependencies) {
      if (!byId.has(dep)) {
        throw new AnvilError(
          "INVALID_INPUT",
          `Plan node "${node.id}" depends on unknown node "${dep}".`,
        );
      }
      indegree.set(node.id, (indegree.get(node.id) ?? 0) + 1);
    }
  }
  const queue = plan.nodes.filter((node) => (indegree.get(node.id) ?? 0) === 0);
  const order: PlanNode[] = [];
  while (queue.length > 0) {
    const node = queue.shift();
    if (node === undefined) break;
    order.push(node);
    for (const other of plan.nodes) {
      if (other.dependencies.includes(node.id)) {
        const remaining = (indegree.get(other.id) ?? 0) - 1;
        indegree.set(other.id, remaining);
        if (remaining === 0) queue.push(other);
      }
    }
  }
  if (order.length !== plan.nodes.length) {
    throw new AnvilError("INVALID_INPUT", "The plan has a dependency cycle.");
  }
  return order;
}

/** Return a copy of the plan with one node patched. */
export function updateNode(plan: Plan, id: string, patch: Partial<PlanNode>): Plan {
  return {
    ...plan,
    nodes: plan.nodes.map((node) => (node.id === id ? { ...node, ...patch } : node)),
  };
}

/** True when every node has reached a terminal state. */
export function isComplete(plan: Plan): boolean {
  return plan.nodes.every((node) => TERMINAL.has(node.status));
}

export interface PlanProgress {
  total: number;
  done: number;
  failed: number;
  remaining: number;
}

export function planProgress(plan: Plan): PlanProgress {
  const done = plan.nodes.filter((node) => node.status === "done").length;
  const failed = plan.nodes.filter((node) => node.status === "failed").length;
  return {
    total: plan.nodes.length,
    done,
    failed,
    remaining: plan.nodes.filter((node) => !TERMINAL.has(node.status)).length,
  };
}
