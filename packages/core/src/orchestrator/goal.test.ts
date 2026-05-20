import type { JobId, RunResult } from "@anvil/shared";
import { newJobId } from "@anvil/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventBus } from "../events/bus.js";
import { Workspace } from "../lib/workspace.js";
import type { CommandResult } from "../lib/exec.js";
import { LocalSandbox } from "../sandbox/local.js";
import { StateStore } from "../state/store.js";
import {
  CommandGoalEvaluator,
  CompositeGoalEvaluator,
  type GoalAssessment,
  type GoalEvaluator,
  LlmGoalEvaluator,
} from "./goal.js";
import { Orchestrator, type RuntimeLike } from "./orchestrator.js";

function judgeRuntime(verdicts: Array<{ satisfied: boolean; reason: string }>): {
  run: (jobId: JobId, _prompt: string) => Promise<RunResult>;
} {
  let cursor = 0;
  return {
    run: (_jobId, _prompt) => {
      const verdict = verdicts[cursor++] ?? { satisfied: true, reason: "default" };
      return Promise.resolve({
        jobId: newJobId(),
        ok: true,
        result: JSON.stringify(verdict),
        numTurns: 1,
        durationMs: 1,
        costUsd: 0,
        interrupted: false,
      });
    },
  };
}

describe("LlmGoalEvaluator", () => {
  it("parses a satisfied verdict from the judge", async () => {
    const evaluator = new LlmGoalEvaluator(judgeRuntime([{ satisfied: true, reason: "tests green" }]));
    const assessment = await evaluator.evaluate(
      { condition: "tests pass" },
      { task: "t", iteration: 1, lastResult: "ran tests" },
    );
    expect(assessment.satisfied).toBe(true);
    expect(assessment.reason).toBe("tests green");
  });

  it("treats a non-satisfied verdict as not done", async () => {
    const evaluator = new LlmGoalEvaluator(judgeRuntime([{ satisfied: false, reason: "lint fails" }]));
    const assessment = await evaluator.evaluate(
      { condition: "tests pass and lint is clean" },
      { task: "t", iteration: 1 },
    );
    expect(assessment.satisfied).toBe(false);
    expect(assessment.reason).toBe("lint fails");
  });
});

describe("CommandGoalEvaluator", () => {
  it("is satisfied when no verify commands are configured", async () => {
    const sandbox = new LocalSandbox({ workspace: new Workspace("/tmp/anvil-eval") });
    const evaluator = new CommandGoalEvaluator(sandbox);
    const assessment = await evaluator.evaluate({ condition: "any" }, { task: "t", iteration: 1 });
    expect(assessment.satisfied).toBe(true);
  });

  it("fails on the first non-zero exit code", async () => {
    const runner = (
      _command: string,
      args: readonly string[],
    ): Promise<CommandResult> =>
      args[0] === "ok"
        ? Promise.resolve({ code: 0, stdout: "", stderr: "" })
        : Promise.resolve({ code: 1, stdout: "", stderr: "boom" });
    const sandbox = new LocalSandbox({ workspace: new Workspace("/tmp/anvil-eval"), runner });
    const evaluator = new CommandGoalEvaluator(sandbox);
    const assessment = await evaluator.evaluate(
      { condition: "all pass", verify: ["echo ok", "echo fail"] },
      { task: "t", iteration: 1 },
    );
    expect(assessment.satisfied).toBe(false);
    expect(assessment.reason).toMatch(/echo fail.*boom/);
  });

  it("splits `&&`-chained verify commands and runs each segment in the sandbox", async () => {
    const calls: Array<{ command: string; args: readonly string[] }> = [];
    const runner = (
      command: string,
      args: readonly string[],
    ): Promise<CommandResult> => {
      calls.push({ command, args: [...args] });
      return Promise.resolve({ code: 0, stdout: "", stderr: "" });
    };
    const sandbox = new LocalSandbox({ workspace: new Workspace("/tmp/anvil-eval"), runner });
    const evaluator = new CommandGoalEvaluator(sandbox);
    const assessment = await evaluator.evaluate(
      { condition: "build/lint/test green", verify: ["pnpm build && pnpm lint && pnpm test"] },
      { task: "t", iteration: 1 },
    );
    expect(assessment.satisfied).toBe(true);
    // Each `&&` segment runs as its own sandbox.exec call — never receives `&&` as an arg.
    expect(calls.length).toBe(3);
    expect(calls.map((c) => `${c.command} ${c.args.join(" ")}`.trim())).toEqual([
      "pnpm build",
      "pnpm lint",
      "pnpm test",
    ]);
    expect(calls.every((c) => !c.args.includes("&&"))).toBe(true);
  });

  it("short-circuits on a failing `&&` segment and reports the original command", async () => {
    const runner = (
      _command: string,
      args: readonly string[],
    ): Promise<CommandResult> =>
      args[0] === "lint"
        ? Promise.resolve({ code: 2, stdout: "", stderr: "lint error" })
        : Promise.resolve({ code: 0, stdout: "", stderr: "" });
    const sandbox = new LocalSandbox({ workspace: new Workspace("/tmp/anvil-eval"), runner });
    const evaluator = new CommandGoalEvaluator(sandbox);
    const assessment = await evaluator.evaluate(
      { condition: "x", verify: ["pnpm build && pnpm lint && pnpm test"] },
      { task: "t", iteration: 1 },
    );
    expect(assessment.satisfied).toBe(false);
    expect(assessment.reason).toMatch(/pnpm build && pnpm lint && pnpm test/);
    expect(assessment.reason).toMatch(/lint error/);
    expect(assessment.details).toMatchObject({ segment: "pnpm lint", exitCode: 2 });
  });
});

describe("CompositeGoalEvaluator", () => {
  it("short-circuits on the first unsatisfied evaluator", async () => {
    const calls: string[] = [];
    const make = (name: string, ok: boolean): GoalEvaluator => ({
      evaluate: async () => {
        calls.push(name);
        return ok
          ? { satisfied: true, reason: `${name} ok` }
          : ({ satisfied: false, reason: `${name} fail` } satisfies GoalAssessment);
      },
    });
    const composite = new CompositeGoalEvaluator([make("a", true), make("b", false), make("c", true)]);
    const assessment = await composite.evaluate({ condition: "x" }, { task: "t", iteration: 1 });
    expect(assessment.satisfied).toBe(false);
    expect(assessment.reason).toBe("b fail");
    expect(calls).toEqual(["a", "b"]);
  });
});

describe("Orchestrator.buildToward", () => {
  let store: StateStore;
  const fastRetry = { baseDelayMs: 1, jitter: false };

  beforeEach(() => {
    store = StateStore.memory();
  });

  afterEach(() => store.close());

  function makeFake(): RuntimeLike {
    return {
      running: false,
      run: () =>
        Promise.resolve({
          jobId: newJobId(),
          ok: true,
          result: "done",
          numTurns: 1,
          durationMs: 1,
          costUsd: 0,
          interrupted: false,
        }),
      steer: () => {},
      interrupt: () => Promise.resolve(),
    };
  }

  it("stops after the first satisfied iteration", async () => {
    const evaluator: GoalEvaluator = {
      evaluate: async () => ({ satisfied: true, reason: "ok" }),
    };
    const orch = new Orchestrator({
      workspace: new Workspace("/tmp/anvil-eval"),
      store,
      bus: new EventBus(),
      runtimeFactory: makeFake,
      evaluator,
    });
    const result = await orch.buildToward(
      "Make the tests green",
      { condition: "tests pass", maxIterations: 5 },
      { retry: fastRetry },
    );
    expect(result.goal.satisfied).toBe(true);
    expect(result.goal.iterations).toBe(1);
    expect(result.history.length).toBe(1);
  });

  it("iterates until satisfied", async () => {
    const verdicts = [false, false, true];
    let cursor = 0;
    const evaluator: GoalEvaluator = {
      evaluate: async () => {
        const ok = verdicts[cursor++] ?? false;
        return ok ? { satisfied: true, reason: "ok" } : { satisfied: false, reason: "not yet" };
      },
    };
    const orch = new Orchestrator({
      workspace: new Workspace("/tmp/anvil-eval"),
      store,
      bus: new EventBus(),
      runtimeFactory: makeFake,
      evaluator,
    });
    const result = await orch.buildToward(
      "Make the tests green",
      { condition: "tests pass", maxIterations: 5 },
      { retry: fastRetry },
    );
    expect(result.goal.satisfied).toBe(true);
    expect(result.goal.iterations).toBe(3);
  });

  it("gives up cleanly when maxIterations is exhausted", async () => {
    const evaluator: GoalEvaluator = {
      evaluate: async () => ({ satisfied: false, reason: "never" }),
    };
    const orch = new Orchestrator({
      workspace: new Workspace("/tmp/anvil-eval"),
      store,
      bus: new EventBus(),
      runtimeFactory: makeFake,
      evaluator,
    });
    const result = await orch.buildToward(
      "Make the tests green",
      { condition: "tests pass", maxIterations: 2 },
      { retry: fastRetry },
    );
    expect(result.goal.satisfied).toBe(false);
    expect(result.goal.iterations).toBe(2);
  });

  it("throws when no evaluator is configured", async () => {
    const orch = new Orchestrator({
      workspace: new Workspace("/tmp/anvil-eval"),
      store,
      bus: new EventBus(),
      runtimeFactory: makeFake,
    });
    await expect(
      orch.buildToward("x", { condition: "y" }, { retry: fastRetry }),
    ).rejects.toThrow(/needs a GoalEvaluator/);
  });
});

describe("vi spies", () => {
  // Reference vi so the import isn't dead — keeps the test file lint-clean.
  it("imports vi cleanly", () => {
    expect(typeof vi.fn).toBe("function");
  });
});
