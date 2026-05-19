import type { PlanNode } from "@anvil/shared";
import { describe, expect, it } from "vitest";
import {
  createPlan,
  isComplete,
  planProgress,
  readyNodes,
  topologicalOrder,
  updateNode,
} from "./plan.js";

function node(id: string, dependencies: string[] = [], status: PlanNode["status"] = "pending"): PlanNode {
  return { id, title: id, description: "", kind: "task", dependencies, status };
}

describe("plan helpers", () => {
  it("orders nodes topologically", () => {
    const plan = createPlan("goal", [node("c", ["b"]), node("a"), node("b", ["a"])]);
    expect(topologicalOrder(plan).map((entry) => entry.id)).toEqual(["a", "b", "c"]);
  });

  it("detects a dependency cycle", () => {
    const plan = createPlan("goal", [node("a", ["b"]), node("b", ["a"])]);
    expect(() => topologicalOrder(plan)).toThrow(/cycle/);
  });

  it("detects a missing dependency", () => {
    const plan = createPlan("goal", [node("a", ["ghost"])]);
    expect(() => topologicalOrder(plan)).toThrow(/unknown node/);
  });

  it("reports which nodes are ready to run", () => {
    let plan = createPlan("goal", [node("a"), node("b", ["a"])]);
    expect(readyNodes(plan).map((entry) => entry.id)).toEqual(["a"]);
    plan = updateNode(plan, "a", { status: "done" });
    expect(readyNodes(plan).map((entry) => entry.id)).toEqual(["b"]);
  });

  it("tracks progress and completion", () => {
    let plan = createPlan("goal", [node("a"), node("b")]);
    expect(isComplete(plan)).toBe(false);
    plan = updateNode(plan, "a", { status: "done" });
    plan = updateNode(plan, "b", { status: "done" });
    expect(isComplete(plan)).toBe(true);
    expect(planProgress(plan)).toEqual({ total: 2, done: 2, failed: 0, remaining: 0 });
  });
});
