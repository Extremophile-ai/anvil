import type { JobId, RunResult } from "@anvil/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventBus } from "../events/bus.js";
import { Workspace } from "../lib/workspace.js";
import { StateStore } from "../state/store.js";
import { Orchestrator, type RuntimeLike } from "./orchestrator.js";

/**
 * A fake runtime that returns canned results — letting us test the
 * orchestrator's plan/heal/persist/reflect/steer wiring without an LLM.
 */
class FakeRuntime implements RuntimeLike {
  running = false;
  readonly calls: string[] = [];
  steerCalls: string[] = [];
  /** When >0, each run() awaits this many ms — letting steer() arrive mid-run. */
  delayMs = 0;
  private cursor = 0;
  private readonly results: RunResult[];

  constructor(results: Array<Partial<RunResult>> = []) {
    this.results = results.map((partial, index) => ({
      jobId: "test" as JobId,
      ok: true,
      result: `done step ${index + 1}`,
      numTurns: 1,
      durationMs: 1,
      costUsd: 0,
      interrupted: false,
      ...partial,
    }));
  }

  async run(_jobId: JobId, task: string): Promise<RunResult> {
    this.calls.push(task);
    this.running = true;
    try {
      if (this.delayMs > 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, this.delayMs));
      }
      return (
        this.results[this.cursor++] ?? {
          jobId: "test" as JobId,
          ok: true,
          result: "default",
          numTurns: 1,
          durationMs: 1,
          costUsd: 0,
          interrupted: false,
        }
      );
    } finally {
      this.running = false;
    }
  }

  steer(text: string): void {
    this.steerCalls.push(text);
  }

  interrupt(): Promise<void> {
    return Promise.resolve();
  }
}

describe("Orchestrator", () => {
  let store: StateStore;
  let orchestrator: Orchestrator;
  let fake: FakeRuntime;
  const fastRetry = { baseDelayMs: 1, jitter: false };

  beforeEach(() => {
    store = StateStore.memory();
    fake = new FakeRuntime();
    orchestrator = new Orchestrator({
      workspace: new Workspace("/tmp/anvil-orch-tests"),
      store,
      bus: new EventBus(),
      runtimeFactory: () => fake,
    });
  });

  afterEach(() => store.close());

  it("plans, runs each node, and succeeds", async () => {
    const result = await orchestrator.build("Refactor the auth module", { retry: fastRetry });
    expect(result.job.status).toBe("succeeded");
    expect(result.plan.nodes.every((node) => node.status === "done")).toBe(true);
    // Heuristic plan for unstructured task: [epic, implement, verify].
    // Epic is processed without a runtime call; implement + verify call the runtime.
    expect(fake.calls.length).toBe(2);
  });

  it("marks the job failed when a node fails and stops there", async () => {
    fake = new FakeRuntime([
      { ok: false, result: "", error: "broken step", interrupted: false },
    ]);
    orchestrator = new Orchestrator({
      workspace: new Workspace("/tmp/anvil-orch-tests"),
      store,
      bus: new EventBus(),
      runtimeFactory: () => fake,
    });
    const result = await orchestrator.build("Refactor the auth module", { retry: fastRetry });
    expect(result.job.status).toBe("failed");
    expect(result.plan.nodes.some((node) => node.status === "failed")).toBe(true);
    expect(result.plan.nodes.find((node) => node.id === "verify")?.status).toBe("pending");
  });

  it("supports mid-build steering", async () => {
    fake = new FakeRuntime([
      { ok: true, result: "step 1 done" },
      { ok: true, result: "step 2 done" },
    ]);
    fake.delayMs = 30; // hold each run long enough for steer() to land mid-build
    orchestrator = new Orchestrator({
      workspace: new Workspace("/tmp/anvil-orch-tests"),
      store,
      bus: new EventBus(),
      runtimeFactory: () => fake,
    });

    const buildPromise = orchestrator.build("Refactor the auth module", { retry: fastRetry });
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
    orchestrator.steer("Prefer the shared currency helper");
    await buildPromise;

    expect(fake.steerCalls).toContain("Prefer the shared currency helper");
  });

  it("calls the planner with the task", async () => {
    let captured: { task: string } | undefined;
    const plannerSpy = vi.fn(async (request: { task: string }) => {
      captured = request;
      return {
        goal: "g",
        nodes: [
          { id: "epic", title: "Epic", description: "", kind: "epic" as const, dependencies: [], status: "pending" as const },
          { id: "one", title: "Step 1", description: "", kind: "task" as const, dependencies: ["epic"], status: "pending" as const },
        ],
      };
    });
    orchestrator = new Orchestrator({
      workspace: new Workspace("/tmp/anvil-orch-tests"),
      store,
      bus: new EventBus(),
      runtimeFactory: () => fake,
      planner: { plan: plannerSpy },
    });
    await orchestrator.build("Build a thing", { retry: fastRetry });
    expect(plannerSpy).toHaveBeenCalledOnce();
    expect(captured?.task).toBe("Build a thing");
  });

  it("persists job + plan to the store", async () => {
    const result = await orchestrator.build("Refactor the auth module", { retry: fastRetry });
    const reloaded = store.db
      .prepare("SELECT status, plan FROM jobs WHERE id = ?")
      .get(result.job.id) as { status: string; plan: string };
    expect(reloaded.status).toBe("succeeded");
    expect(JSON.parse(reloaded.plan).nodes.length).toBe(result.plan.nodes.length);
  });
});
