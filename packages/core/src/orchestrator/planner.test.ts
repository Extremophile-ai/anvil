import { describe, expect, it } from "vitest";
import { HeuristicPlanner, extractJson } from "./planner.js";
import { topologicalOrder } from "./plan.js";

describe("HeuristicPlanner", () => {
  const planner = new HeuristicPlanner();

  it("makes a small plan for an unstructured task", async () => {
    const plan = await planner.plan({ task: "Refactor the auth module" });
    expect(plan.nodes.some((node) => node.kind === "epic")).toBe(true);
    expect(plan.nodes.find((node) => node.id === "verify")).toBeDefined();
    expect(plan.nodes.length).toBeGreaterThanOrEqual(3);
  });

  it("splits frontend from backend and orders backend first", async () => {
    const plan = await planner.plan({
      task: "Build a checkout API and a checkout page that consumes it",
    });
    const backend = plan.nodes.find((node) => node.surface === "backend");
    const frontend = plan.nodes.find((node) => node.surface === "frontend");
    expect(backend).toBeDefined();
    expect(frontend).toBeDefined();
    expect(frontend?.dependencies).toContain(backend!.id);
  });

  it("produces a valid DAG", async () => {
    const plan = await planner.plan({
      task: "Build a backend, a frontend, shared types, and a deploy pipeline",
    });
    expect(() => topologicalOrder(plan)).not.toThrow();
  });
});

describe("extractJson", () => {
  it("extracts a fenced JSON block", () => {
    expect(extractJson('before\n```json\n{"a":1}\n```\nafter')).toEqual({ a: 1 });
  });

  it("extracts bare JSON from prose", () => {
    expect(extractJson('here is the plan {"goal":"x","nodes":[]} all done')).toEqual({
      goal: "x",
      nodes: [],
    });
  });

  it("returns undefined when there is no JSON", () => {
    expect(extractJson("nothing structured here")).toBeUndefined();
  });
});
