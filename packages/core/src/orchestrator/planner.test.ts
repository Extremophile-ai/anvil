import { afterEach, describe, expect, it, vi } from "vitest";
import { EventBus } from "../events/bus.js";
import { HeuristicPlanner, LlmPlanner, extractJson, selectPlannerFromEnv } from "./planner.js";
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

describe("selectPlannerFromEnv", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("defaults to HeuristicPlanner when ANVIL_PLANNER is unset", () => {
    vi.stubEnv("ANVIL_PLANNER", "");
    const planner = selectPlannerFromEnv({ bus: new EventBus(), cwd: "/tmp" });
    expect(planner).toBeInstanceOf(HeuristicPlanner);
  });

  it("returns an LlmPlanner when ANVIL_PLANNER=llm", () => {
    vi.stubEnv("ANVIL_PLANNER", "llm");
    const planner = selectPlannerFromEnv({ bus: new EventBus(), cwd: "/tmp" });
    expect(planner).toBeInstanceOf(LlmPlanner);
  });

  it("honors ANVIL_PLANNER_MODEL when selecting the LlmPlanner runtime", () => {
    vi.stubEnv("ANVIL_PLANNER", "llm");
    vi.stubEnv("ANVIL_PLANNER_MODEL", "claude-haiku-custom");
    const planner = selectPlannerFromEnv({ bus: new EventBus(), cwd: "/tmp" });
    expect(planner).toBeInstanceOf(LlmPlanner);
    // Reach into the private runtime config to confirm the env-driven model
    // landed on the dedicated Haiku planner runtime.
    const runtime = (planner as unknown as { runtime: { config: { model?: string; maxTurns?: number; permissionMode?: string; settingSources?: readonly string[] } } }).runtime;
    expect(runtime.config.model).toBe("claude-haiku-custom");
    expect(runtime.config.maxTurns).toBe(3);
    expect(runtime.config.permissionMode).toBe("bypassPermissions");
    expect(runtime.config.settingSources).toEqual([]);
  });

  it("defaults the LlmPlanner runtime to haiku when ANVIL_PLANNER_MODEL is unset", () => {
    vi.stubEnv("ANVIL_PLANNER", "llm");
    vi.stubEnv("ANVIL_PLANNER_MODEL", "");
    const planner = selectPlannerFromEnv({ bus: new EventBus(), cwd: "/tmp" });
    const runtime = (planner as unknown as { runtime: { config: { model?: string } } }).runtime;
    expect(runtime.config.model).toBe("haiku");
  });
});
