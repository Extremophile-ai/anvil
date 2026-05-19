/**
 * Goal mode — Anvil's port of Claude Code's `/goal` capability.
 *
 * A goal is a natural-language completion condition (e.g. "all tests in
 * test/auth pass and lint is clean"). The orchestrator runs an iteration, the
 * configured {@link GoalEvaluator} decides whether the condition holds, and if
 * not, the orchestrator runs another iteration with the unmet reason fed back
 * as a correction — up to `maxIterations`.
 *
 * Two evaluators ship by default:
 *   - {@link LlmGoalEvaluator}: a fast-model judge (mirrors `/goal`'s Haiku
 *     check). Reads the last iteration's summary and decides "done yet?".
 *   - {@link CommandGoalEvaluator}: runs verifier commands in a sandbox; every
 *     command must exit 0.
 *
 * They compose with {@link CompositeGoalEvaluator} (AND semantics).
 */
import { type JobId, type RunResult, newJobId } from "@anvil/shared";
import { AnvilError, errorMessage } from "../lib/errors.js";
import type { Sandbox } from "../sandbox/types.js";
import { extractJson } from "./planner.js";

export interface GoalDefinition {
  /** A short, natural-language description of when the build is done. */
  condition: string;
  /** Shell-style commands run in the workspace; every command must exit 0. */
  verify?: string[];
  /** Hard ceiling on iterations. Default 5. */
  maxIterations?: number;
}

export interface GoalContext {
  /** The original task the goal accompanies. */
  task: string;
  /** 1-based iteration counter. */
  iteration: number;
  /** A summary of the last iteration's output, if any. */
  lastResult?: string;
}

export interface GoalAssessment {
  satisfied: boolean;
  /** One-line explanation — what made the goal satisfied or what's missing. */
  reason: string;
  details?: Record<string, unknown>;
}

export interface GoalEvaluator {
  evaluate(goal: GoalDefinition, context: GoalContext): Promise<GoalAssessment>;
}

/** Runtime surface the LLM judge needs — a minimal seam, no orchestrator-level deps. */
export interface JudgeRuntime {
  run(jobId: JobId, prompt: string): Promise<RunResult>;
}

/**
 * A natural-language judge. Sends the goal and the iteration summary to a
 * fast model and asks for a JSON verdict. Mirrors Claude Code's `/goal`.
 */
export class LlmGoalEvaluator implements GoalEvaluator {
  constructor(private readonly runtime: JudgeRuntime) {}

  async evaluate(goal: GoalDefinition, context: GoalContext): Promise<GoalAssessment> {
    const prompt = [
      "You are a strict goal-completion judge.",
      "",
      `Goal: ${goal.condition}`,
      `Iteration: ${context.iteration}`,
      "",
      "Most recent work summary:",
      context.lastResult ?? "(no summary)",
      "",
      "Decide whether the goal is satisfied right now. Reply with ONLY a JSON object,",
      'with no prose or markdown fences, matching: { "satisfied": boolean, "reason": "<one line>" }',
    ].join("\n");

    const result = await this.runtime.run(newJobId(), prompt);
    if (!result.ok) {
      return { satisfied: false, reason: `Judge run failed: ${result.error ?? "(no error)"}` };
    }
    const parsed = extractJson(result.result);
    if (!parsed || typeof parsed !== "object") {
      return { satisfied: false, reason: "Judge returned no JSON object." };
    }
    const raw = parsed as { satisfied?: unknown; reason?: unknown };
    return {
      satisfied: raw.satisfied === true,
      reason: typeof raw.reason === "string" ? raw.reason : "",
    };
  }
}

/** Run verify commands in the sandbox; every command must exit 0. */
export class CommandGoalEvaluator implements GoalEvaluator {
  constructor(private readonly sandbox: Sandbox) {}

  async evaluate(goal: GoalDefinition, _context: GoalContext): Promise<GoalAssessment> {
    const commands = goal.verify ?? [];
    if (commands.length === 0) {
      return { satisfied: true, reason: "No verify commands configured." };
    }
    for (const command of commands) {
      const [head, ...rest] = command.split(/\s+/);
      if (head === undefined || head.length === 0) continue;
      try {
        const result = await this.sandbox.exec(head, rest);
        if (result.code !== 0) {
          const detail = (result.stderr || result.stdout).trim().slice(0, 240);
          return {
            satisfied: false,
            reason: `\`${command}\` exited ${result.code}: ${detail}`,
            details: { command, exitCode: result.code },
          };
        }
      } catch (err) {
        return { satisfied: false, reason: `\`${command}\` failed to run: ${errorMessage(err)}` };
      }
    }
    return { satisfied: true, reason: "All verify commands exited 0." };
  }
}

/** Compose evaluators with AND semantics — every one must report satisfied. */
export class CompositeGoalEvaluator implements GoalEvaluator {
  constructor(private readonly evaluators: readonly GoalEvaluator[]) {}

  async evaluate(goal: GoalDefinition, context: GoalContext): Promise<GoalAssessment> {
    for (const evaluator of this.evaluators) {
      const assessment = await evaluator.evaluate(goal, context);
      if (!assessment.satisfied) return assessment;
    }
    return { satisfied: true, reason: "All evaluators reported satisfied." };
  }
}

/** Convenience constructor used by the CLI / orchestrator wiring. */
export function makeGoalGuard(error: string): GoalEvaluator {
  return {
    evaluate: () => Promise.reject(new AnvilError("INVALID_INPUT", error)),
  };
}
