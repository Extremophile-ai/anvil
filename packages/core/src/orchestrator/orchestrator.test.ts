import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { JobId, RunResult } from "@anvil/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventBus } from "../events/bus.js";
import { Workspace } from "../lib/workspace.js";
import { SkillLibrary } from "../skills/library.js";
import type { Skill } from "../skills/types.js";
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

function makeSkill(overrides: Partial<Skill> = {}): Skill {
  return {
    id: "skill_test",
    name: "render-invoice",
    kind: "skill",
    description: "Render an invoice as a PDF document",
    content: "# Render Invoice\n\nProduce a well-formed invoice PDF here.",
    capabilities: ["invoice", "pdf"],
    tags: ["skill", "invoice"],
    version: 1,
    validated: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
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

  it("wires Anvil's tool registry as an MCP server and disallows raw writes", async () => {
    const { ToolRegistry } = await import("../tools/registry.js");
    const { builtinTools } = await import("../tools/builtins/index.js");
    let capturedConfig: { mcpServers?: Record<string, unknown>; disallowedTools?: string[] } | undefined;
    const registry = new ToolRegistry({
      workspace: new Workspace("/tmp/anvil-orch-tests"),
      bus: new EventBus(),
    });
    registry.registerAll(builtinTools());

    orchestrator = new Orchestrator({
      workspace: new Workspace("/tmp/anvil-orch-tests"),
      store,
      bus: new EventBus(),
      toolRegistry: registry,
      runtimeFactory: (config) => {
        capturedConfig = config as typeof capturedConfig;
        return fake;
      },
    });
    await orchestrator.build("Refactor the auth module", { retry: fastRetry });

    expect(capturedConfig?.mcpServers?.anvil).toBeDefined();
    expect(capturedConfig?.disallowedTools).toEqual(
      expect.arrayContaining(["Write", "Edit", "MultiEdit", "NotebookEdit"]),
    );
  });

  describe("with a SkillLibrary", () => {
    let dir: string;
    let library: SkillLibrary;

    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), "anvil-orch-skills-"));
      library = new SkillLibrary(dir);
    });

    afterEach(() => rmSync(dir, { recursive: true, force: true }));

    it("surfaces validated matching skills into the agent's system prompt", async () => {
      library.save(makeSkill({ name: "render-invoice", capabilities: ["invoice", "pdf"], validated: true }));
      library.save(
        makeSkill({
          name: "draft-invoice",
          description: "Draft invoice payload",
          content: "# Draft Invoice",
          capabilities: ["invoice", "draft"],
          tags: ["skill", "invoice"],
          validated: false,
        }),
      );
      library.save(
        makeSkill({
          name: "publish-newsletter",
          description: "Schedule outbound newsletter delivery",
          content: "# Publish Newsletter",
          capabilities: ["newsletter", "schedule"],
          tags: ["skill", "messaging"],
          validated: true,
        }),
      );

      let capturedSystemPrompt: string | undefined;
      orchestrator = new Orchestrator({
        workspace: new Workspace("/tmp/anvil-orch-tests"),
        store,
        bus: new EventBus(),
        skills: library,
        runtimeFactory: (config) => {
          capturedSystemPrompt = config.systemPrompt;
          return fake;
        },
      });

      await orchestrator.build("Produce invoice PDF for billing", { retry: fastRetry });

      expect(capturedSystemPrompt).toBeDefined();
      expect(capturedSystemPrompt).toContain("Validated library skills");
      expect(capturedSystemPrompt).toContain("render-invoice");
      // Unvalidated skills must never be surfaced.
      expect(capturedSystemPrompt).not.toContain("draft-invoice");
      // Unrelated validated skills should not match the query.
      expect(capturedSystemPrompt).not.toContain("publish-newsletter");
    });

    it("emits a skill.surfaced event when validated skills match", async () => {
      library.save(makeSkill({ name: "render-invoice", capabilities: ["invoice", "pdf"], validated: true }));

      const bus = new EventBus();
      const surfaced: Array<{ message: string; data?: Record<string, unknown> }> = [];
      bus.on((event) => {
        if (event.kind === "skill.surfaced") {
          const entry: { message: string; data?: Record<string, unknown> } = { message: event.message };
          if (event.data !== undefined) entry.data = event.data;
          surfaced.push(entry);
        }
      });

      orchestrator = new Orchestrator({
        workspace: new Workspace("/tmp/anvil-orch-tests"),
        store,
        bus,
        skills: library,
        runtimeFactory: () => fake,
      });

      await orchestrator.build("Produce invoice PDF for billing", { retry: fastRetry });

      expect(surfaced.length).toBe(1);
      expect(surfaced[0]?.data?.skills).toEqual(["render-invoice"]);
    });

    it("omits the skills block when no validated skill matches", async () => {
      library.save(
        makeSkill({
          name: "publish-newsletter",
          description: "Schedule outbound newsletter delivery",
          content: "# Publish Newsletter",
          capabilities: ["newsletter", "schedule"],
          tags: ["skill", "messaging"],
          validated: true,
        }),
      );

      let capturedSystemPrompt: string | undefined;
      orchestrator = new Orchestrator({
        workspace: new Workspace("/tmp/anvil-orch-tests"),
        store,
        bus: new EventBus(),
        skills: library,
        runtimeFactory: (config) => {
          capturedSystemPrompt = config.systemPrompt;
          return fake;
        },
      });

      await orchestrator.build("Refactor the auth module", { retry: fastRetry });

      expect(capturedSystemPrompt).toBeDefined();
      expect(capturedSystemPrompt).not.toContain("Validated library skills");
    });
  });
});
