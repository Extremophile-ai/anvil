/**
 * The learning loop — the single object that ties the three learning
 * mechanisms together: the failure log, the regression eval suite, and
 * reflection into memory.
 */
import type { EventBus } from "../events/bus.js";
import { truncate } from "../lib/text.js";
import type { MemoryManager } from "../memory/manager.js";
import type { StateStore } from "../state/store.js";
import { EvalSuite } from "./evals.js";
import { FailureLog } from "./failure-log.js";
import { HeuristicDistiller, type ReflectionResult, Reflector } from "./reflection.js";
import type { Distiller, EvalCase, FailureEntry, FailureInput, ReflectionInput } from "./types.js";

export interface LearningLoopDeps {
  store: StateStore;
  memory: MemoryManager;
  /** Path to the human-readable `failures.md`. */
  failuresPath: string;
  /** Defaults to the heuristic distiller. */
  distiller?: Distiller;
  bus?: EventBus;
}

export class LearningLoop {
  readonly failures: FailureLog;
  readonly evals: EvalSuite;
  readonly reflector: Reflector;
  private readonly memory: MemoryManager;
  private readonly bus: EventBus | undefined;

  constructor(deps: LearningLoopDeps) {
    this.memory = deps.memory;
    this.bus = deps.bus;
    this.failures = new FailureLog({ store: deps.store, failuresPath: deps.failuresPath });
    this.evals = new EvalSuite(deps.store);
    this.reflector = new Reflector({
      distiller: deps.distiller ?? new HeuristicDistiller(),
      memory: deps.memory,
      bus: deps.bus,
    });
  }

  /**
   * Record a corrected mistake. This is the heart of "every mistake becomes
   * structurally impossible": log it, seed a regression eval that guards
   * against a repeat, and remember the structural fix.
   */
  async logFailure(input: FailureInput): Promise<{ failure: FailureEntry; evalCase: EvalCase }> {
    const failure = this.failures.record(input);
    const evalCase = this.evals.add({
      name: `regression: ${truncate(input.whatHappened, 60)}`,
      scenario: input.whatHappened,
      expectation: `Must not recur. Root cause: ${input.rootCause}. Guard: ${input.harnessImprovement}`,
      sourceFailureId: failure.id,
    });
    await this.memory.remember({
      type: "feedback",
      description: `Avoid repeating: ${truncate(input.whatHappened, 80)}`,
      body: [
        `Root cause: ${input.rootCause}`,
        `Fix applied: ${input.fixApplied}`,
        `Harness improvement: ${input.harnessImprovement}`,
      ].join("\n"),
      tags: ["failure", input.severity],
    });
    if (this.bus && input.jobId) {
      this.bus.publish(input.jobId, "reflection.completed", "info", "Logged a failure and seeded a regression eval.", {
        failureId: failure.id,
        evalId: evalCase.id,
      });
    }
    return { failure, evalCase };
  }

  /** Run a post-mortem on a finished run, committing lessons to memory. */
  reflect(input: ReflectionInput): Promise<ReflectionResult> {
    return this.reflector.reflect(input);
  }
}
